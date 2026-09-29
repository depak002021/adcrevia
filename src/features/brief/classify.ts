import {
  briefDepth,
  briefIsComplete,
  decisionPolicies,
  isActionable,
  missingFact,
  resolveGate,
  scoreToPercent,
  scrapeMatchedProduct,
  urlIsSafeToFetch,
} from "@/lib/decisions/questions"
import { decide } from "@/lib/decisions/service"
import type { DecisionProvider } from "@/lib/decisions/types"

import type { StoredMessage } from "./conversation"
import type { BriefState } from "./state"

/**
 * The classifier layer.
 *
 * These are the judgements the product used to make by counting form fields or
 * comparing strings. Each one is a typed question with a recorded answer and a
 * threshold that can be reviewed, and — critically — each one can come back
 * "unknown", which the callers have to handle rather than rounding to a yes or a no.
 *
 * Questions are batched. The brief assessment asks three things in one round trip
 * because both decision backends read the state once and answer everything against
 * it in parallel; asking them separately would triple the latency of every turn for
 * no extra information.
 */

/** How many of the user's own turns the classifier sees. */
const TRANSCRIPT_TURNS = 12

export type BriefAssessment = {
  /** 0-100, from the depth score. This is what the brief meter shows. */
  completeness: number
  /** True, false, or null when the answer was not confident enough to act on. */
  ready: boolean | null
  /** Which single fact would help most, when the classifier is sure enough to say. */
  missingFact: string | null
  /** Raw probability, for the audit view and for tuning the threshold. */
  readyProbability: number
  provider: string
  model: string
  latencyMs: number
}

export async function assessBrief(input: {
  state: BriefState
  messages: StoredMessage[]
  projectId?: string | null
  agentRunId?: string | null
  provider?: DecisionProvider
}): Promise<BriefAssessment> {
  const result = await decide({
    questions: {
      brief_is_complete: briefIsComplete,
      missing_fact: missingFact,
      brief_depth: briefDepth,
    },
    state: decisionState(input.state, input.messages),
    projectId: input.projectId ?? input.state.projectId,
    agentRunId: input.agentRunId ?? null,
    provider: input.provider,
  })

  const gate = result.answers.brief_is_complete
  const depth = result.answers.brief_depth
  const missing = result.answers.missing_fact

  return {
    completeness: scoreToPercent(depth.score, briefDepth.criteria.length),
    ready: resolveGate("brief_is_complete", gate),
    // `nothing_material` is the classifier saying there is no gap, which is not a
    // gap to report.
    missingFact:
      isActionable("missing_fact", missing.confidence) && missing.choice !== "nothing_material"
        ? missing.choice
        : null,
    readyProbability: gate.noul,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
  }
}

export type ScrapeMatchAssessment = {
  /** Null means ask the user. */
  matched: boolean | null
  probability: number
  candidate: { name: string; description: string | null; url: string | null } | null
}

/**
 * Did the crawler find the product the user meant?
 *
 * A brand site has many products, and building a whole campaign around the wrong
 * one is the worst outcome available here — worse than an extra question. So a
 * confident yes proceeds and everything else asks.
 */
export async function assessScrapeMatch(input: {
  state: BriefState
  messages: StoredMessage[]
  agentRunId?: string | null
  provider?: DecisionProvider
}): Promise<ScrapeMatchAssessment> {
  const candidate = input.state.website?.products[0] ?? null
  if (!candidate) return { matched: null, probability: 0, candidate: null }

  const result = await decide({
    questions: { scrape_matched_product: scrapeMatchedProduct },
    state: {
      ...decisionState(input.state, input.messages),
      candidate_product: candidate,
    },
    projectId: input.state.projectId,
    agentRunId: input.agentRunId ?? null,
    provider: input.provider,
  })

  const answer = result.answers.scrape_matched_product
  return {
    matched: resolveGate("scrape_matched_product", answer),
    probability: answer.noul,
    candidate: { name: candidate.name, description: candidate.description, url: candidate.url },
  }
}

/**
 * Is this URL worth fetching at all?
 *
 * Belt and braces, never the control. `safeFetch` does the real enforcement with
 * DNS resolution and address checks, because a classifier must not be load-bearing
 * for security. This catches what a URL policy cannot see — a public host that is
 * plainly not a brand site — before the crawler spends bandwidth on it.
 */
export async function assessUrl(input: {
  url: string
  state: BriefState
  agentRunId?: string | null
  provider?: DecisionProvider
}): Promise<{ safe: boolean | null; probability: number }> {
  const result = await decide({
    questions: { url_is_safe_to_fetch: urlIsSafeToFetch },
    state: {
      url: input.url,
      product_prompt: input.state.product.prompt,
      known_brand: input.state.website?.brandName ?? null,
    },
    projectId: input.state.projectId,
    agentRunId: input.agentRunId ?? null,
    provider: input.provider,
  })

  const answer = result.answers.url_is_safe_to_fetch
  return { safe: resolveGate("url_is_safe_to_fetch", answer), probability: answer.noul }
}

/**
 * Which phase the conversation is in.
 *
 * Derived from state and the assessment rather than advanced by the model, so the
 * phase cannot be talked forward. Order matters: an unconfirmed product candidate
 * outranks a high completeness score, because a complete brief about the wrong
 * product is the expensive mistake.
 */
export function derivePhase(input: {
  state: BriefState
  assessment: Pick<BriefAssessment, "ready">
  productConfirmed: boolean
}): BriefState["phase"] {
  // Only a genuine choice: a product-page link, or a site with one product, has none.
  const website = input.state.website
  if (website && website.products.length > 1 && !website.primaryProduct && !input.productConfirmed) return "PRODUCT_CONFIRM"
  if (input.state.directions.length > 0) return input.assessment.ready ? "READY" : "DIRECTION"
  return input.assessment.ready ? "READY" : "DISCOVERY"
}

/** Whether generation may proceed, and why not when it may not. */
export function generationGate(assessment: Pick<BriefAssessment, "ready" | "missingFact">): {
  allowed: boolean
  reason?: string
} {
  if (assessment.ready === true) return { allowed: true }
  if (assessment.ready === false) {
    return {
      allowed: false,
      reason: assessment.missingFact
        ? `The brief still needs one thing: ${MISSING_FACT_PROMPTS[assessment.missingFact] ?? assessment.missingFact}. Ask the user about it before generating.`
        : "The brief is not specific enough to generate from yet. Ask the user one focused question first.",
    }
  }
  // Not confident either way. Generation spends credits, so the uncertain case is
  // resolved by asking rather than by guessing.
  return {
    allowed: false,
    reason: "It is not clear yet whether the brief is ready. Confirm the product and the look with the user first.",
  }
}

const MISSING_FACT_PROMPTS: Record<string, string> = {
  product_identity: "what the product actually is",
  physical_detail: "its material, finish or form",
  audience: "who it is for or where it is used",
  mood: "the feeling the campaign should have",
  brand_context: "brand name, palette or existing visual language",
  usage_context: "where the images will run",
}

/**
 * Assemble the state a classifier sees.
 *
 * The transcript is trimmed to the recent tail and to user and assistant turns:
 * tool output is already reflected in the structured state, and including it twice
 * would let a long crawl result crowd out the user's own words.
 */
export function decisionState(state: BriefState, messages: StoredMessage[]): Record<string, unknown> {
  return {
    product_prompt: state.product.prompt,
    enhanced_prompt: state.product.enhanced,
    product_facts: state.product.facts,
    // Real photos settle the physical detail (material, colour, print, form).
    ...(state.product.photos.uploaded + state.product.photos.fromWebsite > 0
      ? { product_photos: { ...state.product.photos, note: "Real product photos fix its material, colour, print and form." } }
      : {}),
    website: state.website
      ? {
          url: state.website.url,
          brand: state.website.brandName,
          products: state.website.products,
          palette: state.website.palette,
        }
      : null,
    palette: state.palette,
    directions: state.directions,
    conversation: messages
      .filter((message) => message.role === "USER" || message.role === "ASSISTANT")
      .slice(-TRANSCRIPT_TURNS)
      .map((message) => ({ role: message.role.toLowerCase(), content: message.content })),
  }
}

/** Exposed so the admin console can show the thresholds a gate is using. */
export const briefThresholds = {
  ready: decisionPolicies.brief_is_complete,
  productMatch: decisionPolicies.scrape_matched_product,
  url: decisionPolicies.url_is_safe_to_fetch,
}
