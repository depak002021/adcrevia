import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from "./types"

/**
 * The decision catalogue.
 *
 * Every judgement the product makes about its own state is declared here, with a
 * stable key that is also the `Decision.key` column. Two reasons for a central
 * catalogue rather than inline questions at each call site:
 *
 *  - The wording IS the behaviour. A question phrased one way in the brief flow
 *    and another way in the admin preview is two different classifiers wearing
 *    one name, and the audit trail would not show it.
 *  - Thresholds have to be reviewable together. Each entry states what happens
 *    below its confidence floor, which is the only honest way to design around a
 *    probabilistic answer: there is always a case where it does not know.
 *
 * `instructions` and `criteria` are what the backend sees. `minConfidence` and
 * `fallback` are ours and are never sent.
 */

/** Builders exist to pin the option keys into the type, so answers narrow. */
const noul = <Question extends NoulQuestion>(question: Question) => question
const choice = <Option extends string>(question: ChoiceQuestion<Option>) => question
const score = <Question extends ScoreQuestion>(question: Question) => question

/**
 * How the product behaves when a decision is not confident enough to act on.
 *
 * `ask` means put the question to the user — always available in a conversational
 * brief and always the safest option. `assume_no` and `assume_yes` pick the
 * direction whose failure mode is cheapest: never spend credits or fetch a remote
 * URL on a coin flip, but never block a user over one either.
 */
export type DecisionFallback = "ask" | "assume_no" | "assume_yes" | "escalate"

export type DecisionPolicy = {
  /** Below this margin the answer is treated as unknown. */
  minConfidence: number
  fallback: DecisionFallback
  /** For noul gates: the probability at which the gate opens. */
  threshold?: number
}

export const decisionPolicies = {
  brief_is_complete: { minConfidence: 0.2, fallback: "assume_no", threshold: 0.7 },
  missing_fact: { minConfidence: 0.15, fallback: "ask" },
  brief_depth: { minConfidence: 0.1, fallback: "assume_no" },
  scrape_matched_product: { minConfidence: 0.3, fallback: "ask", threshold: 0.65 },
  url_is_safe_to_fetch: { minConfidence: 0.4, fallback: "assume_no", threshold: 0.8 },
  directions_are_distinct: { minConfidence: 0.2, fallback: "assume_yes", threshold: 0.5 },
  user_intent: { minConfidence: 0.25, fallback: "ask" },
} as const satisfies Record<string, DecisionPolicy>

export type DecisionKey = keyof typeof decisionPolicies

/**
 * Is there enough in the conversation to generate?
 *
 * This replaces a fixed-length form as the definition of "ready". A form can only
 * check that fields are non-empty; it cannot tell "a matte black steel water
 * bottle for trail runners, premium outdoor feel" from "bottle".
 */
export const briefIsComplete = noul({
  type: "noul",
  instructions:
    "Given the conversation and everything gathered about the product, is there enough specific information to brief a commercial photographer and get usable campaign images on the first attempt?",
  criteria: {
    true: "The product itself, its material or form, the audience or use context, and the desired mood are all identifiable from the state. Absent details could be chosen by a competent art director without guessing at the product.",
    false: "The product is generic or ambiguous, or the images would have to invent a defining attribute such as what the product actually is, what it is made of, or who it is for.",
  },
})

/** Which single fact, if supplied next, would improve the brief the most. */
export const missingFact = choice({
  type: "choice",
  instructions:
    "Which ONE missing piece of information would most improve the campaign images? Consider only what is genuinely absent from the state.",
  criteria: {
    product_identity: "What the product actually is, or its category, is unclear",
    physical_detail: "Material, finish, colour, size or form is unstated and cannot be inferred",
    audience: "Who the product is for, or where it is used, is unstated",
    mood: "The desired feeling, style or tone of the campaign is unstated",
    brand_context: "Brand name, logo usage, palette or existing visual language is unstated",
    usage_context: "Where the images will run (social, web, print, retail) is unstated",
    nothing_material: "The state already covers everything needed; no single addition would materially help",
  },
})

/** How rich the brief is, for the meter the UI shows while the user types. */
export const briefDepth = score({
  type: "score",
  instructions:
    "How complete and specific is this creative brief, judged as a professional photographic brief rather than as a sentence?",
  criteria: [
    "Empty or a bare product noun with nothing else",
    "The product is identifiable but almost nothing about it is specified",
    "The product and one or two attributes are clear; mood or audience is missing",
    "Product, attributes and intent are clear; a competent art director could shoot it",
    "Fully specified: product, physical detail, audience, mood and brand context all present and consistent",
  ],
})

/**
 * Did the crawler find the product the user meant?
 *
 * A brand site has many products. Picking the wrong one and silently building a
 * campaign around it is the worst available outcome, so a confident yes proceeds,
 * anything less asks. This is what drives the "Is this the one?" confirmation.
 */
export const scrapeMatchedProduct = noul({
  type: "noul",
  instructions:
    "Does the product found on the website match the product the user described in their brief?",
  criteria: {
    true: "The candidate is the same product the user described, or the only plausible match on the site",
    false: "The candidate is a different product, a category page, an accessory, or the site sells several products and the description does not single one out",
  },
})

/**
 * A pre-flight check on a URL before anything fetches it.
 *
 * Belt and braces, not the control. `safeFetch` does the real enforcement with
 * DNS resolution and address checks, and a classifier must never be load-bearing
 * for security. This exists to catch the cases a URL policy cannot see — a public
 * host that is obviously not a brand site — before the crawler spends time and
 * bandwidth on it.
 */
export const urlIsSafeToFetch = noul({
  type: "noul",
  instructions:
    "Is this URL plausibly the public website of the product or brand the user is describing, and appropriate to crawl for brand context?",
  criteria: {
    true: "A public company, brand, product or store page consistent with the brief",
    false: "An internal hostname, an IP address, a link shortener, a login or admin path, a file download, a social or marketplace profile unrelated to the brief, or anything unrelated to the described product",
  },
})

/** Are the proposed directions genuinely different shoots? */
export const directionsAreDistinct = noul({
  type: "noul",
  instructions:
    "Are these creative directions meaningfully different from each other as photographic shoots, rather than the same shoot with different wording?",
  criteria: {
    true: "Each direction differs in at least two of environment, lighting, composition, camera treatment or mood, and would visibly produce a different image",
    false: "Two or more directions would produce near-identical images, or differ only in adjectives and title",
  },
})

/*
 * Not here: scoring a generated image.
 *
 * The six always-null sub-score columns on `ImageEvaluation` want exactly this
 * treatment, and it was the obvious candidate for a `score` batch. It does not
 * belong in this layer: Jev takes text only and its own documentation says to
 * pre-process images into text before sending them, so an `image_on_brand` question
 * here would be answerable by one backend and not the other — which is the one thing
 * a pluggable interface must not allow.
 *
 * Judging an image needs a vision model, so those scores come back from the
 * evaluation call that already looks at the image. See `features/images/evaluation`.
 */

/** What the user is actually asking for on this turn of the conversation. */
export const userIntent = choice({
  type: "choice",
  instructions: "What is the user asking for with their latest message?",
  criteria: {
    describe_product: "Supplying or correcting information about the product or brand",
    share_website: "Pointing at a website or link to be read",
    request_generation: "Asking to proceed and generate images or video now",
    refine_direction: "Asking to change, replace or adjust a proposed creative direction",
    ask_question: "Asking the assistant a question rather than supplying information",
    off_topic: "Not about this campaign",
  },
})

/**
 * Level count per score question, for turning a 0..levels-1 expectation into the
 * 0..100 the database and the UI use.
 */
export function scoreToPercent(value: number, levels: number): number {
  if (levels <= 1) return 0
  const percent = (value / (levels - 1)) * 100
  return Math.round(Math.min(100, Math.max(0, percent)))
}

/** True when an answer is confident enough for the caller to act on it. */
export function isActionable(key: DecisionKey, confidence: number): boolean {
  return confidence >= decisionPolicies[key].minConfidence
}

/**
 * Resolve a noul gate against its policy.
 *
 * Returns `null` when the answer is not confident enough, which forces the caller
 * to handle "do not know" as its own case rather than reading an unconfident
 * probability as a yes or a no.
 */
export function resolveGate(key: DecisionKey, answer: { noul: number; confidence: number }): boolean | null {
  // Widened to the interface so `threshold` is readable; the literal types of the
  // catalogue are for reviewing the values, not for reading them back.
  const policy: DecisionPolicy = decisionPolicies[key]
  if (!isActionable(key, answer.confidence)) return null
  return answer.noul >= (policy.threshold ?? 0.5)
}
