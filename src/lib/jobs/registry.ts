import type { JobKind } from "@/generated/prisma/enums"
import { payloadSchemas, PermanentJobError, type JobContext, type JobHandler } from "./types"

/**
 * Handler lookup.
 *
 * Registration is explicit and partial on purpose: a kind with no handler is a
 * hard error rather than a silent success. Kinds are added to the enum before
 * their handler exists (the schema is migrated ahead of the feature), and a
 * queue that quietly marked unknown work as done would lose it.
 */
const handlers = new Map<JobKind, JobHandler>()

export function registerHandler<K extends JobKind>(kind: K, handler: JobHandler<K>) {
  if (handlers.has(kind)) throw new Error(`HANDLER_ALREADY_REGISTERED:${kind}`)
  handlers.set(kind, handler as JobHandler)
}

export function registeredKinds(): JobKind[] {
  return [...handlers.keys()]
}

/**
 * Validate the stored payload and run the handler.
 *
 * Payloads are parsed here rather than inside each handler so a payload written
 * by an older deploy fails as a permanent error with a clear code, instead of
 * throwing somewhere deep in the handler and being retried three times.
 */
export async function runJob(context: JobContext): Promise<void> {
  const { kind, payload } = context.job

  const handler = handlers.get(kind)
  if (!handler) throw new PermanentJobError("HANDLER_NOT_REGISTERED", `No handler for ${kind}`)

  const schema = payloadSchemas[kind]
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new PermanentJobError("INVALID_JOB_PAYLOAD", `Payload rejected for ${kind}`)
  }

  await handler(parsed.data, context)
}

/** Test seam. Never call from application code. */
export function resetHandlersForTest() {
  handlers.clear()
}
