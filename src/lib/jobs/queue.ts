import { Prisma } from "@/generated/prisma/client"
import type { JobKind } from "@/generated/prisma/enums"
import { getPrisma } from "@/lib/db/prisma"
import { sanitizeDiagnostic } from "@/features/admin/logs/service"
import type { ClaimedJob } from "./types"

/**
 * Postgres-backed work queue.
 *
 * Why Postgres rather than a broker: the queue has to be consulted by the same
 * transactions that write the domain rows, the job history is something the admin
 * console needs to show next to the generation it belongs to, and the volume here
 * is a few hundred jobs a day. `FOR UPDATE SKIP LOCKED` gives exactly the
 * at-least-once semantics required, and one fewer service to run on a host that
 * is already at its CPU limit.
 *
 * At-least-once, not exactly-once: a worker can die after finishing the external
 * work but before marking the job done, so every handler must be idempotent.
 * That is why the domain tables carry their own idempotency keys.
 */

/** How long a claim is held before another worker may take the job. */
const DEFAULT_LEASE_MS = 2 * 60_000

/** Ceiling on retry backoff, so a job never disappears for hours. */
const MAX_BACKOFF_MS = 10 * 60_000

/** Progress writes are collapsed to at most one per interval per job. */
const PROGRESS_THROTTLE_MS = 750

export type EnqueueInput<K extends JobKind = JobKind> = {
  kind: K
  payload: Prisma.InputJsonValue
  /**
   * Stable identity for this unit of work. When present, enqueueing again
   * returns the existing job instead of creating a duplicate.
   */
  dedupeKey?: string
  projectId?: string | null
  /** Lower runs first. 50 for work a user is watching, 200 for batch renders. */
  priority?: number
  /** Delay before the job becomes claimable. */
  delayMs?: number
  maxAttempts?: number
}

export async function enqueue<K extends JobKind>(input: EnqueueInput<K>) {
  const db = getPrisma()
  const data = {
    kind: input.kind,
    payload: input.payload,
    dedupeKey: input.dedupeKey,
    projectId: input.projectId ?? null,
    priority: input.priority ?? 100,
    maxAttempts: input.maxAttempts ?? 3,
    runAfter: input.delayMs ? new Date(Date.now() + input.delayMs) : new Date(),
  }

  if (!input.dedupeKey) return db.job.create({ data })

  // Racing enqueues are expected: two browser tabs, a double-click, or a retry of
  // the request that scheduled the work. Let the unique index arbitrate and
  // reconcile afterwards, rather than checking first and leaving a gap between
  // the check and the insert.
  try {
    return await db.job.create({ data })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    return reconcileDuplicate(input.dedupeKey, data)
  }
}

/**
 * Decide what a duplicate key means.
 *
 * Dedupe is scoped to work that is still outstanding: "do not queue this twice
 * while one is pending or running". It is deliberately NOT a permanent claim on
 * the key, because `dedupeKey` is globally unique including finished rows — so
 * treating any collision as "already done" would make a second generation run,
 * or a re-evaluation after retrying a failed frame, impossible forever.
 *
 * A live job wins and is returned unchanged. A settled one releases the key so
 * the new job can take it, which also keeps the finished row in the history
 * instead of overwriting it.
 */
async function reconcileDuplicate(dedupeKey: string, data: Prisma.JobCreateInput) {
  const db = getPrisma()
  const existing = await db.job.findUnique({ where: { dedupeKey } })
  if (!existing) {
    // The holder disappeared between the failed insert and this read. Retry once.
    return db.job.create({ data })
  }

  if (existing.status === "RUNNING") return existing
  if (existing.status === "QUEUED") {
    // The earliest request wins: a job queued with a delay (a fallback) is pulled
    // forward when the same work is asked for now.
    const wanted = data.runAfter instanceof Date ? data.runAfter : new Date()
    if (wanted < existing.runAfter) {
      return db.job.update({ where: { id: existing.id }, data: { runAfter: wanted } })
    }
    return existing
  }

  return db.$transaction(async (transaction) => {
    // Release the key from the settled row, preserving it for audit.
    await transaction.job.update({
      where: { id: existing.id },
      data: { dedupeKey: null },
    })
    return transaction.job.create({ data })
  })
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  )
}

/**
 * Take the next runnable job.
 *
 * A single statement, so there is no window in which a job is selected but not
 * yet claimed. The inner `SELECT ... FOR UPDATE SKIP LOCKED` is what lets several
 * workers poll concurrently without blocking on each other or handing the same
 * row to two of them.
 *
 * `ORDER BY priority, runAfter` matches the `[status, runAfter, priority]` index,
 * and `updatedAt` is set explicitly because Prisma's `@updatedAt` is applied by
 * the client and does not exist in raw SQL.
 */
export async function claimNextJob(options?: {
  kinds?: JobKind[]
  lockedBy?: string
  leaseMs?: number
}): Promise<ClaimedJob | null> {
  const db = getPrisma()
  const leaseMs = options?.leaseMs ?? DEFAULT_LEASE_MS
  const lockedBy = options?.lockedBy ?? "worker"

  // An empty array would produce `IN ()`, which is invalid SQL, so the filter is
  // omitted entirely when no kinds are given.
  const kindFilter =
    options?.kinds && options.kinds.length > 0
      ? Prisma.sql`AND kind = ANY(${options.kinds}::"JobKind"[])`
      : Prisma.empty

  const rows = await db.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" AS j
    SET status = 'RUNNING',
        attempts = j.attempts + 1,
        "startedAt" = COALESCE(j."startedAt", now()),
        "leaseExpiresAt" = now() + make_interval(secs => ${leaseMs / 1000}::double precision),
        "lockedBy" = ${lockedBy},
        "safeErrorCode" = NULL,
        "updatedAt" = now()
    WHERE j.id = (
      SELECT inner_job.id
      FROM "Job" AS inner_job
      WHERE inner_job.status = 'QUEUED'
        AND inner_job."runAfter" <= now()
        ${kindFilter}
      ORDER BY inner_job.priority ASC, inner_job."runAfter" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING j.id, j.kind, j.payload, j.attempts, j."maxAttempts", j."projectId"
  `
  return rows[0] ?? null
}

/** Extend the lease on a job still being worked. */
export async function heartbeatJob(jobId: string, leaseMs = DEFAULT_LEASE_MS) {
  const db = getPrisma()
  await db.$executeRaw`
    UPDATE "Job"
    SET "leaseExpiresAt" = now() + make_interval(secs => ${leaseMs / 1000}::double precision),
        "updatedAt" = now()
    WHERE id = ${jobId} AND status = 'RUNNING'
  `
}

const lastProgressWrite = new Map<string, number>()

/**
 * Publish progress for the project event stream.
 *
 * Throttled because the natural callers are tight loops — ffmpeg emits progress
 * several times a second, and a render is minutes long. Completion values are
 * always written, so the final state is never dropped by the throttle.
 */
export async function reportProgress(jobId: string, progress: number, label?: string) {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)))
  const now = Date.now()
  const last = lastProgressWrite.get(jobId) ?? 0
  if (clamped < 100 && now - last < PROGRESS_THROTTLE_MS) return
  lastProgressWrite.set(jobId, now)

  await getPrisma().job.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: { progress: clamped, progressLabel: label },
  })
}

export async function completeJob(jobId: string) {
  lastProgressWrite.delete(jobId)
  await getPrisma().job.updateMany({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      progress: 100,
      leaseExpiresAt: null,
      lockedBy: null,
      safeErrorCode: null,
      lastError: null,
      completedAt: new Date(),
    },
  })
}

/**
 * Record a failure and decide whether to retry.
 *
 * `permanent` short-circuits the remaining attempts: a moderated prompt or an
 * unsupported aspect ratio will fail identically three times, and each attempt
 * costs provider credits.
 */
export async function failJob(
  jobId: string,
  input: {
    safeErrorCode: string
    message?: string
    permanent?: boolean
    retryAfterMs?: number
  },
) {
  lastProgressWrite.delete(jobId)
  const db = getPrisma()
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true },
  })
  if (!job) return

  const exhausted = job.attempts >= job.maxAttempts
  const giveUp = Boolean(input.permanent) || exhausted

  // Operator-facing detail only. Sanitised and truncated, because a provider
  // error can carry a whole response body and occasionally a key.
  const lastError = input.message
    ? String(sanitizeDiagnostic(input.message)).slice(0, 2000)
    : null

  if (giveUp) {
    await db.job.updateMany({
      where: { id: jobId },
      data: {
        status: "FAILED",
        leaseExpiresAt: null,
        lockedBy: null,
        safeErrorCode: input.safeErrorCode,
        lastError,
        completedAt: new Date(),
      },
    })
    return
  }

  await db.job.updateMany({
    where: { id: jobId },
    data: {
      status: "QUEUED",
      leaseExpiresAt: null,
      lockedBy: null,
      safeErrorCode: input.safeErrorCode,
      lastError,
      runAfter: new Date(Date.now() + (input.retryAfterMs ?? backoffMs(job.attempts))),
    },
  })
}

/**
 * Exponential backoff with jitter: 2s, 4s, 8s, ... capped.
 *
 * The jitter matters more than the curve. Several jobs failing on the same
 * provider outage would otherwise retry in lockstep forever, reproducing the
 * thundering herd that caused the outage.
 */
export function backoffMs(attempts: number) {
  const base = Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** Math.max(0, attempts - 1))
  const jitter = base * 0.25 * Math.random()
  return Math.round(base + jitter)
}

/**
 * Return abandoned jobs to the queue.
 *
 * A worker killed mid-job (OOM, deploy, host reboot) leaves its row RUNNING with
 * a lease that simply stops being renewed. Nothing else would ever notice, so
 * without this sweep the work is lost silently — which is the failure the whole
 * queue exists to prevent.
 *
 * Jobs that have already used their attempts are failed rather than requeued, so
 * a job that reliably kills its worker cannot loop forever.
 */
export async function reclaimExpiredJobs(): Promise<number> {
  return getPrisma().$executeRaw`
    UPDATE "Job"
    SET status = CASE
          WHEN attempts >= "maxAttempts" THEN 'FAILED'::"JobStatus"
          ELSE 'QUEUED'::"JobStatus"
        END,
        "leaseExpiresAt" = NULL,
        "lockedBy" = NULL,
        "safeErrorCode" = 'LEASE_EXPIRED',
        "completedAt" = CASE
          WHEN attempts >= "maxAttempts" THEN now()
          ELSE NULL
        END,
        "updatedAt" = now()
    WHERE status = 'RUNNING' AND "leaseExpiresAt" < now()
  `
}

/** Stop a job from running. Terminal — a cancelled job is never retried. */
export async function cancelJob(jobId: string, safeErrorCode = "CANCELLED") {
  await getPrisma().job.updateMany({
    where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "CANCELLED",
      leaseExpiresAt: null,
      lockedBy: null,
      safeErrorCode,
      completedAt: new Date(),
    },
  })
}

/** Live job state for a project, for the event stream and the admin console. */
export function listProjectJobs(projectId: string) {
  return getPrisma().job.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      status: true,
      progress: true,
      progressLabel: true,
      attempts: true,
      maxAttempts: true,
      safeErrorCode: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  })
}
