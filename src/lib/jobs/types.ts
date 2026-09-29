import { z } from "zod"

import type { JobKind } from "@/generated/prisma/enums"

/**
 * Job payload contracts.
 *
 * Payloads are persisted JSON, so they outlive the code that wrote them: a job
 * enqueued before a deploy is executed by the code after it. Every payload is
 * therefore parsed on the way out of the database rather than trusted, and the
 * schemas here are the compatibility boundary. Adding an optional field is safe;
 * making one required is a breaking change for any job already in the queue.
 *
 * Payloads carry IDs, never objects. A job that embedded a snapshot of a project
 * would execute against stale data after a retry.
 */

export const imageGeneratePayload = z.object({
  projectId: z.string().cuid(),
  /** Explicit user choice. Omitted means "use the active provider". */
  provider: z.enum(["openai", "bfl", "google"]).optional(),
  model: z.string().max(100).optional(),
})

export const imageEvaluatePayload = z.object({
  projectId: z.string().cuid(),
})

export const videoPollPayload = z.object({
  videoId: z.string().cuid(),
  /**
   * Ownership is re-checked inside the handler, because the job outlives the
   * request that created it and the account may have been deactivated since.
   */
  userId: z.string().cuid(),
})

export const videoComposePayload = z.object({
  compositionId: z.string().cuid(),
})

export const videoExportPayload = z.object({
  compositionId: z.string().cuid(),
  preset: z.string().min(1).max(40),
})

export const websiteScrapePayload = z.object({
  projectId: z.string().cuid(),
  url: z.string().url().max(2048),
})

export const agentStepPayload = z.object({
  conversationId: z.string().cuid(),
})

export const videoSubmitPayload = z.object({
  projectId: z.string().cuid(),
  userId: z.string().cuid(),
  /** Validated again by `videoInputSchema` in the handler. */
  input: z.unknown(),
})

/** Maps each kind to the schema that validates its payload. */
export const payloadSchemas = {
  IMAGE_GENERATE: imageGeneratePayload,
  IMAGE_EVALUATE: imageEvaluatePayload,
  VIDEO_SUBMIT: videoSubmitPayload,
  VIDEO_POLL: videoPollPayload,
  VIDEO_COMPOSE: videoComposePayload,
  VIDEO_EXPORT: videoExportPayload,
  WEBSITE_SCRAPE: websiteScrapePayload,
  AGENT_STEP: agentStepPayload,
} as const satisfies Record<JobKind, z.ZodType>

export type PayloadFor<K extends JobKind> = z.infer<(typeof payloadSchemas)[K]>

/** The subset of a Job row a handler is given. */
export type ClaimedJob = {
  id: string
  kind: JobKind
  payload: unknown
  attempts: number
  maxAttempts: number
  projectId: string | null
}

/**
 * Context handed to every handler.
 *
 * `report` and `heartbeat` are separate on purpose. Reporting progress is for the
 * user's benefit and is throttled; extending the lease is for the queue's
 * benefit and must not be skipped, or a long render gets reclaimed mid-flight
 * and runs twice.
 */
export type JobContext = {
  job: ClaimedJob
  /** Update the visible progress. Throttled; safe to call in a tight loop. */
  report(progress: number, label?: string): Promise<void>
  /** Extend the lease. Call from any step that can exceed the lease duration. */
  heartbeat(): Promise<void>
  /** Resolves once shutdown has been requested, so a handler can stop early. */
  signal: AbortSignal
}

export type JobHandler<K extends JobKind = JobKind> = (
  payload: PayloadFor<K>,
  context: JobContext,
) => Promise<void>

/**
 * Thrown by a handler to mark a failure as final. The queue skips the remaining
 * attempts, because retrying a rejected prompt or an unsupported aspect ratio
 * only burns provider credits to reach the same answer.
 */
export class PermanentJobError extends Error {
  constructor(public readonly safeErrorCode: string, message?: string) {
    super(message ?? safeErrorCode)
    this.name = "PermanentJobError"
  }
}

/**
 * Thrown by a handler to request a retry at a specific time, rather than the
 * default backoff. Used when a provider tells us when to come back — a
 * rate-limit reset, or a task that is still queued upstream.
 */
export class RetryJobError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly safeErrorCode = "RETRY_REQUESTED",
    message?: string,
  ) {
    super(message ?? safeErrorCode)
    this.name = "RetryJobError"
  }
}
