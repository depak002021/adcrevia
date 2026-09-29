import type { JobKind } from "@/generated/prisma/enums"
import {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  reclaimExpiredJobs,
  reportProgress,
} from "./queue"
import { runJob } from "./registry"
import { PermanentJobError, RetryJobError, type ClaimedJob } from "./types"

/**
 * The worker loop.
 *
 * Separated from the process entrypoint so it can be driven directly in a test
 * without signals, timers or a real database: everything it touches is either a
 * parameter or an injected dependency.
 *
 * Concurrency is deliberately low by default. The host this runs on is a 4-vCPU
 * box already sitting at a load average above 3, shared with three other
 * production stacks, and one of the job kinds is ffmpeg. Two slots is the point
 * where the queue drains without the neighbours noticing.
 */

export type RunnerOptions = {
  /** Slots processed in parallel. */
  concurrency?: number
  /** Restrict this worker to a subset of kinds. Omit for all registered kinds. */
  kinds?: JobKind[]
  /** Identifier written to `lockedBy`, for debugging which worker holds a job. */
  workerId?: string
  /** Pause between polls when the queue is empty. */
  idleDelayMs?: number
  /** How often to return abandoned jobs to the queue. */
  reclaimIntervalMs?: number
  leaseMs?: number
  /** Injected for tests. */
  now?: () => number
  logger?: Pick<Console, "info" | "warn" | "error">
}

const DEFAULTS = {
  concurrency: 2,
  idleDelayMs: 2_000,
  reclaimIntervalMs: 30_000,
  leaseMs: 2 * 60_000,
}

export type RunnerHandle = {
  /** Resolves once every in-flight job has settled. */
  done: Promise<void>
  /** Requests shutdown. In-flight jobs are given the chance to stop early. */
  stop(): void
}

export function startRunner(options: RunnerOptions = {}): RunnerHandle {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULTS.concurrency)
  const idleDelayMs = options.idleDelayMs ?? DEFAULTS.idleDelayMs
  const reclaimIntervalMs = options.reclaimIntervalMs ?? DEFAULTS.reclaimIntervalMs
  const leaseMs = options.leaseMs ?? DEFAULTS.leaseMs
  const workerId = options.workerId ?? `worker-${process.pid}`
  const log = options.logger ?? console

  const controller = new AbortController()
  let lastReclaim = 0

  async function sleep(ms: number) {
    if (controller.signal.aborted) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      // Unblock immediately on shutdown rather than waiting out the idle delay,
      // so a deploy is not held up by a sleeping worker.
      controller.signal.addEventListener("abort", () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }

  async function slot(index: number) {
    while (!controller.signal.aborted) {
      // One slot owns the sweep so it does not run `concurrency` times over.
      if (index === 0) {
        const now = options.now?.() ?? Date.now()
        if (now - lastReclaim > reclaimIntervalMs) {
          lastReclaim = now
          try {
            const reclaimed = await reclaimExpiredJobs()
            if (reclaimed > 0) log.warn("[worker] reclaimed abandoned jobs", { count: reclaimed })
          } catch (error) {
            // A failed sweep must not kill the slot; the next pass retries.
            log.error("[worker] reclaim failed", { message: describe(error) })
          }
        }
      }

      let job: ClaimedJob | null = null
      try {
        job = await claimNextJob({ kinds: options.kinds, lockedBy: workerId, leaseMs })
      } catch (error) {
        // Almost always the database being briefly unreachable. Back off rather
        // than spinning on a connection error.
        log.error("[worker] claim failed", { message: describe(error) })
        await sleep(idleDelayMs)
        continue
      }

      if (!job) {
        await sleep(idleDelayMs)
        continue
      }

      await execute(job)
    }
  }

  async function execute(job: ClaimedJob) {
    const startedAt = Date.now()
    try {
      await runJob({
        job,
        signal: controller.signal,
        report: (progress, label) => reportProgress(job.id, progress, label),
        heartbeat: () => heartbeatJob(job.id, leaseMs),
      })
      await completeJob(job.id)
      log.info("[worker] job succeeded", {
        id: job.id,
        kind: job.kind,
        ms: Date.now() - startedAt,
      })
    } catch (error) {
      // A retry request is a normal control-flow signal, not an incident, so it
      // is logged at info and does not consume the permanent-failure path.
      if (error instanceof RetryJobError) {
        await failJob(job.id, {
          safeErrorCode: error.safeErrorCode,
          retryAfterMs: error.retryAfterMs,
        })
        return
      }

      const permanent = error instanceof PermanentJobError
      await failJob(job.id, {
        safeErrorCode: permanent ? error.safeErrorCode : "JOB_FAILED",
        message: describe(error),
        permanent,
      })
      log.error("[worker] job failed", {
        id: job.id,
        kind: job.kind,
        attempts: job.attempts,
        permanent,
        message: describe(error),
      })
    }
  }

  const slots = Array.from({ length: concurrency }, (_, index) => slot(index))

  return {
    done: Promise.all(slots).then(() => undefined),
    stop: () => controller.abort(),
  }
}

/** Name and message only — never a stack, never a provider response body. */
function describe(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
