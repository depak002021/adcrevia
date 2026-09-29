import { runBriefStep } from "@/features/brief/service"
import { DecisionError } from "@/lib/decisions/types"
import { AgentError } from "@/lib/agent/types"

import { registerHandler } from "../registry"
import { PermanentJobError, RetryJobError } from "../types"

/**
 * One turn of the conversational brief.
 *
 * The turn runs here rather than in the request that produced it for the same
 * reason image generation does: it can call a model several times and start a crawl,
 * which is far too long to hold a connection open, and the user closing the tab must
 * not abandon it.
 *
 * Failure handling is about what the user sees. A rate limit or an unreachable
 * provider is retried, because the conversation is recoverable and the transcript
 * already holds their message. A missing conversation or a rejected payload is
 * permanent, because retrying cannot conjure the row back.
 */

/** Nothing a retry can fix. */
const PERMANENT_CODES = new Set([
  // The conversation or project is gone.
  "NOT_FOUND",
  "AGENT_MODEL_NOT_CONFIGURED",
  "DECISION_PROVIDER_NOT_CONFIGURED",
])

/** How long to wait before answering a message that arrived mid-turn. */
const FOLLOW_UP_DELAY_MS = 750

registerHandler("AGENT_STEP", async (payload, context) => {
  await context.report(10, "Thinking")

  try {
    const result = await runBriefStep(payload.conversationId, context)

    // A message landed while this turn was running. Because agent steps are deduped
    // per conversation, it joined THIS job instead of creating one — so the only way
    // it gets answered is to run again. A retry does that, and reuses the queue's
    // own lease and attempt accounting rather than a second scheduling path.
    if (result.followUpNeeded) {
      await context.report(90, "One more thing")
      throw new RetryJobError(FOLLOW_UP_DELAY_MS, "FOLLOW_UP_PENDING")
    }

    await context.report(
      100,
      result.stop === "step_budget" ? "Needs a little more detail" : "Ready for your reply",
    )
  } catch (error) {
    // Not a failure: the turn succeeded and another one is owed.
    if (error instanceof RetryJobError) throw error

    // A rate limit tells us when to come back, so the queue's generic backoff is
    // replaced with the interval the provider asked for.
    if (error instanceof DecisionError && error.code === "DECISION_RATE_LIMITED") {
      throw new RetryJobError(error.retryAfterMs ?? 15_000, error.code)
    }

    const code = safeCodeOf(error)
    if (PERMANENT_CODES.has(code)) throw new PermanentJobError(code)
    throw error
  }
})

function safeCodeOf(error: unknown): string {
  if (error instanceof AgentError) return error.safeErrorCode
  if (error instanceof DecisionError) return error.code
  // HttpError carries a status; a 404 here means the conversation is gone.
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status
    if (status === 404) return "NOT_FOUND"
  }
  return "AGENT_STEP_FAILED"
}
