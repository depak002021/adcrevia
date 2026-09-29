import { getPrisma } from "@/lib/db/prisma"

const sensitiveKey = /authorization|api.?key|password|token|cookie|secret|credential/i
const sensitiveText = /(bearer\s+)[A-Za-z0-9._~+\/-]+|\bsk-[A-Za-z0-9_-]+/gi

export function sanitizeDiagnostic(value: unknown): any {
  if (typeof value === "string") return value.replace(sensitiveText, "$1[REDACTED]")
  if (Array.isArray(value)) return value.map(sanitizeDiagnostic)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : sanitizeDiagnostic(item)]))
  }
  return value
}

import { randomUUID } from "node:crypto"

type ImageLogEntry = {
  projectId: string
  imageId?: string | null
  status: "STARTED" | "SUCCEEDED" | "FAILED"
  provider: string
  model?: string | null
  durationMs?: number | null
  safeErrorCode?: string | null
  details?: unknown
}

/**
 * Record a sanitized image generation log row. Best-effort: logging must never
 * break or fail a generation, so errors here are swallowed. Details are
 * sanitized to strip any credential-like fields before persistence.
 */
export async function recordImageGenerationLog(entry: ImageLogEntry) {
  try {
    await getPrisma().imageGenerationLog.create({
      data: {
        projectId: entry.projectId,
        imageId: entry.imageId ?? null,
        status: entry.status,
        provider: entry.provider,
        model: entry.model ?? null,
        durationMs: entry.durationMs ?? null,
        safeErrorCode: entry.safeErrorCode ?? null,
        correlationId: randomUUID(),
        details: entry.details === undefined ? undefined : sanitizeDiagnostic(entry.details),
      },
    })
  } catch {
    // Non-fatal: never let logging interfere with generation.
  }
}

type VideoLogEntry = {
  projectId: string
  videoId?: string | null
  status: "STARTED" | "SUCCEEDED" | "FAILED"
  provider: string
  model?: string | null
  providerTaskId?: string | null
  durationMs?: number | null
  safeErrorCode?: string | null
  details?: unknown
}

/** Record a sanitized video generation log row. Best-effort (see above). */
export async function recordVideoGenerationLog(entry: VideoLogEntry) {
  try {
    await getPrisma().videoGenerationLog.create({
      data: {
        projectId: entry.projectId,
        videoId: entry.videoId ?? null,
        status: entry.status,
        provider: entry.provider,
        model: entry.model ?? null,
        providerTaskId: entry.providerTaskId ?? null,
        durationMs: entry.durationMs ?? null,
        safeErrorCode: entry.safeErrorCode ?? null,
        correlationId: randomUUID(),
        details: entry.details === undefined ? undefined : sanitizeDiagnostic(entry.details),
      },
    })
  } catch {
    // Non-fatal.
  }
}

export async function listGenerationLogs(kind: "IMAGE" | "VIDEO", take = 100) {
  const limit = Math.min(Math.max(take, 1), 250)
  const include = { project: { select: { name: true } } }
  if (kind === "IMAGE") {
    const rows = await getPrisma().imageGenerationLog.findMany({ orderBy: { createdAt: "desc" }, take: limit, include })
    return rows.map(({ project, imageId, ...row }) => ({ ...row, subjectId: imageId, projectName: project.name, details: sanitizeDiagnostic(row.details) }))
  }
  const rows = await getPrisma().videoGenerationLog.findMany({ orderBy: { createdAt: "desc" }, take: limit, include })
  return rows.map(({ project, videoId, providerTaskId: _task, ...row }) => ({ ...row, subjectId: videoId, projectName: project.name, details: sanitizeDiagnostic(row.details) }))
}

/**
 * One row per generation: a render's "started" row is dropped once its outcome row
 * exists (the outcome carries the actual cost), so only renders still in progress
 * show their estimate.
 */
export function onePerGeneration<T extends { status: string; subjectId: string | null }>(rows: T[]): T[] {
  const settled = new Set(rows.filter((row) => row.status !== "STARTED" && row.subjectId).map((row) => row.subjectId))
  return rows.filter((row) => row.status !== "STARTED" || !row.subjectId || !settled.has(row.subjectId))
}
