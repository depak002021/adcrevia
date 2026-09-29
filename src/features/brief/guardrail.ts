import type { AnyAgentTool, PreflightDecision } from "@/lib/agent/types"
import type { DecisionProvider } from "@/lib/decisions/types"

import { assessBrief, assessUrl, generationGate, type BriefAssessment } from "./classify"
import type { StoredMessage } from "./conversation"
import type { BriefState } from "./state"

/**
 * Pre-flight checks on the agent's tools.
 *
 * The pattern this follows is the one a decision model is actually good for: a
 * small, fast, calibrated judgement in front of an action that is expensive or hard
 * to undo, with the program — not the model — deciding what to do with the answer.
 *
 * The bar is not the same for every tool, and the asymmetry is the point:
 *
 *  - Spending provider credits requires a confident YES. An uncertain answer means
 *    ask the user, because a wasted generation costs money and a wasted question
 *    costs a sentence.
 *  - Cheap, reversible actions are blocked only on a confident NO. Refusing to
 *    draft directions because a classifier was unsure would make the product feel
 *    broken for no saving.
 *
 * A refusal is returned to the model as a tool result with a reason, so it explains
 * itself to the user instead of retrying the same call until the step budget ends.
 */

/** Which bar a guarded tool has to clear. */
const TOOL_REQUIREMENTS: Record<string, "confident_yes" | "not_confident_no" | "none"> = {
  start_generation: "confident_yes",
  propose_directions: "not_confident_no",
  // Recording a fact and changing a count are guarded because they mutate durable
  // state, but no classifier can tell whether a fact the user just stated is worth
  // writing down. Ownership is enforced in the tool itself.
  record_brief: "none",
  set_image_count: "none",
  // `read_website` has its own question rather than a brief-readiness bar.
  read_website: "none",
}

export type GuardrailDependencies = {
  state: BriefState
  /**
   * The state as it is now. A crawl can land during the turn: judged on the state
   * from the start of it, a brief whose photos arrived a second earlier was
   * "missing physical detail" and the shot list was refused.
   */
  readState?: () => Promise<BriefState | null>
  messages: StoredMessage[]
  agentRunId: string | null
  provider?: DecisionProvider
  /**
   * Reuses the assessment already computed for this turn when there is one, so a
   * turn does not pay for the same classification twice.
   */
  assessment?: BriefAssessment | null
}

export function createBriefGuardrail(dependencies: GuardrailDependencies) {
  // Memoised for the life of one agent invocation. The state cannot change under
  // it in a way that matters: the tools that change readiness are themselves
  // guarded, and a stale "not ready" only costs one extra conversational turn.
  // Memoised per state: re-assessed only when the state has actually changed.
  let assessment = dependencies.assessment ?? null
  let assessedFor = assessment ? JSON.stringify(dependencies.state) : null

  const readAssessment = async (): Promise<BriefAssessment> => {
    const state = (await dependencies.readState?.().catch(() => null)) ?? dependencies.state
    const signature = JSON.stringify(state)
    if (assessment && assessedFor === signature) return assessment
    assessment = await assessBrief({
      state,
      messages: dependencies.messages,
      agentRunId: dependencies.agentRunId,
      provider: dependencies.provider,
    })
    assessedFor = signature
    return assessment
  }

  return async function preflight(tool: AnyAgentTool, input: unknown): Promise<PreflightDecision> {
    if (tool.name === "read_website") return checkUrl(dependencies, input)

    const requirement = TOOL_REQUIREMENTS[tool.name] ?? "none"
    if (requirement === "none") return { allowed: true }

    const current = await readAssessment()

    if (requirement === "confident_yes") return generationGate(current)

    // `not_confident_no`: only a confident negative blocks.
    if (current.ready === false) {
      return {
        allowed: false,
        reason:
          "There is not enough in the brief to draft directions from yet. Ask the user one focused question about the product first.",
      }
    }
    return { allowed: true }
  }
}

/**
 * Gate on the URL question rather than on brief readiness.
 *
 * Reading a site is exactly how an empty brief gets filled, so requiring a complete
 * brief first would be backwards. What matters here is whether the URL is plausibly
 * the brand's own site — the address-level checks happen later, in `safeFetch`,
 * where they are enforcement rather than advice.
 */
async function checkUrl(dependencies: GuardrailDependencies, input: unknown): Promise<PreflightDecision> {
  const url = readUrl(input)
  if (!url) return { allowed: false, reason: "No URL was supplied." }

  const verdict = await assessUrl({
    url,
    state: dependencies.state,
    agentRunId: dependencies.agentRunId,
    provider: dependencies.provider,
  })

  if (verdict.safe === false) {
    return {
      allowed: false,
      reason:
        "That link does not look like the product's own website. Ask the user for the brand's site address, or carry on from what they have described.",
    }
  }

  // Unknown is allowed through: the crawl itself is cheap and every address-level
  // protection still applies at fetch time.
  return { allowed: true }
}

function readUrl(input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const value = (input as { url?: unknown }).url
  return typeof value === "string" && value.length > 0 ? value : null
}
