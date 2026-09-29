import { z } from "zod"

import {
  indexedProbabilities,
  keyedProbabilities,
  legendFrom,
  marginConfidence,
  normalizeDistribution,
  roundProbability,
  roundScore,
  selectionConfidence,
} from "./confidence"
import { serializeState } from "./state"
import {
  DecisionError,
  type DecisionAnswer,
  type DecisionBatch,
  type DecisionProvider,
  type DecisionProviderResult,
  type DecisionQuestion,
} from "./types"

/**
 * TypeSafe Jev backend.
 *
 * Jev is a decision model rather than a chat model: one request carries the state
 * once plus a map of typed questions, and it answers all of them in a single
 * parallel pass. That shape is why this layer exists — the alternative is a chat
 * completion per judgement, each one re-reading the same context and returning
 * prose to be parsed.
 *
 * Wire contract (POST /v1/systemone, bearer auth):
 *   request  { model, state, questions: { id: { type, instructions, criteria? } } }
 *   response { model, answers: { id: typed answer }, usage: { input_tokens, output_tokens } }
 *
 * The internal question type is deliberately the same shape as the wire format,
 * so the batch is sent as-is. Reference: https://docs.typesafe.ai/models
 */

const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone"

/** `jev-latest` tracks the newest stable release; the response reports the pinned id. */
const DEFAULT_MODEL = "jev-latest"

/** Jev answers in well under a second, so a slow response means something is wrong. */
const DEFAULT_TIMEOUT_MS = 15_000

const noulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number(),
  confidence: z.number().optional(),
})

const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().optional(),
  probabilities: z.record(z.string(), z.number()),
})

const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number().optional(),
  legend: z.record(z.string(), z.string()).optional(),
  probabilities: z.record(z.string(), z.number()),
})

const wireAnswerSchema = z.discriminatedUnion("type", [
  noulAnswerSchema,
  choiceAnswerSchema,
  scoreAnswerSchema,
])

export type WireAnswer = z.infer<typeof wireAnswerSchema>

const responseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), wireAnswerSchema),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
})

export type TypeSafeDecisionOptions = {
  apiKey: string
  model?: string
  /** Overridable so the same adapter works against a gateway that proxies Jev. */
  endpoint?: string
  timeoutMs?: number
  /** Injected in tests. */
  fetchImpl?: typeof fetch
}

export class TypeSafeDecisionProvider implements DecisionProvider {
  readonly name = "typesafe"

  private readonly apiKey: string
  private readonly model: string
  private readonly endpoint: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: TypeSafeDecisionOptions) {
    if (!options.apiKey) throw new DecisionError("DECISION_PROVIDER_NOT_CONFIGURED", "typesafe api key missing")
    this.apiKey = options.apiKey
    this.model = options.model ?? DEFAULT_MODEL
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async evaluate(input: { state: unknown; questions: DecisionBatch }): Promise<DecisionProviderResult> {
    const ids = Object.keys(input.questions)
    if (ids.length === 0) throw new DecisionError("DECISION_ANSWER_INVALID", "empty question batch")

    const state = serializeState(asStateObject(input.state))
    const startedAt = Date.now()

    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ model: this.model, state: state.value, questions: input.questions }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      // The detail is ours, not the provider's, so nothing from the request or a
      // response body can reach a log line through this path.
      throw new DecisionError(
        "DECISION_PROVIDER_UNAVAILABLE",
        error instanceof Error && error.name === "TimeoutError" ? "typesafe timeout" : "typesafe unreachable",
      )
    }

    if (response.status === 429) {
      throw new DecisionError(
        "DECISION_RATE_LIMITED",
        "typesafe 429",
        retryAfterMs(response.headers.get("retry-after")),
      )
    }
    if (!response.ok) {
      // Status only. A body can contain an echo of the request.
      throw new DecisionError("DECISION_PROVIDER_UNAVAILABLE", `typesafe ${response.status}`)
    }

    const parsed = responseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new DecisionError("DECISION_ANSWER_INVALID", "typesafe response shape")

    const answers: Record<string, DecisionAnswer> = {}
    for (const id of ids) {
      answers[id] = normalizeWireAnswer(id, input.questions[id], parsed.data.answers[id])
    }

    return {
      answers,
      model: parsed.data.model ?? this.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: parsed.data.usage?.input_tokens ?? null,
      outputTokens: parsed.data.usage?.output_tokens ?? null,
    }
  }
}

/**
 * Convert one wire answer into the internal shape.
 *
 * The answer's type is checked against the type of the question that was asked.
 * A backend that returned a `choice` where a `noul` was requested would otherwise
 * flow straight into `answer.noul`, read `undefined`, and produce a
 * confident-looking false. Exported for direct unit tests of that check.
 */
export function normalizeWireAnswer(
  id: string,
  question: DecisionQuestion,
  answer: WireAnswer | undefined,
): DecisionAnswer {
  if (!answer) throw new DecisionError("DECISION_ANSWER_INVALID", `missing answer for ${id}`)
  if (answer.type !== question.type) {
    throw new DecisionError("DECISION_ANSWER_INVALID", `expected ${question.type} for ${id}`)
  }

  if (question.type === "noul" && answer.type === "noul") {
    const distribution = normalizeDistribution([answer.noul, 1 - answer.noul])
    return {
      type: "noul",
      noul: roundProbability(distribution[0]),
      yes: distribution[0] >= 0.5,
      confidence: marginConfidence(distribution),
      providerConfidence: answer.confidence ?? null,
    }
  }

  if (question.type === "choice" && answer.type === "choice") {
    const keys = Object.keys(question.criteria)
    const distribution = normalizeDistribution(keys.map((key) => answer.probabilities[key] ?? 0))
    // The declared option set is authoritative. An option the question never
    // offered cannot be acted on by code that only handles the declared ones.
    const selected = keys.indexOf(answer.choice)
    if (selected < 0) throw new DecisionError("DECISION_ANSWER_INVALID", `unknown option for ${id}`)
    return {
      type: "choice",
      choice: keys[selected],
      probabilities: keyedProbabilities(keys, distribution),
      confidence: selectionConfidence(distribution, selected),
      providerConfidence: answer.confidence ?? null,
    }
  }

  if (question.type === "score" && answer.type === "score") {
    const levels = question.criteria
    const distribution = normalizeDistribution(levels.map((_, index) => answer.probabilities[String(index)] ?? 0))
    return {
      type: "score",
      // Jev's `score` is the expectation over the level distribution, which is
      // the same quantity the OpenAI backend computes, so the two are comparable.
      score: roundScore(answer.score),
      probabilities: indexedProbabilities(distribution),
      legend: answer.legend ?? legendFrom(levels),
      confidence: marginConfidence(distribution),
      providerConfidence: answer.confidence ?? null,
    }
  }

  throw new DecisionError("DECISION_ANSWER_INVALID", `unsupported question type for ${id}`)
}

/** Jev accepts a string, an object, or an array of strings; normalise to an object. */
function asStateObject(state: unknown): Record<string, unknown> {
  if (state && typeof state === "object" && !Array.isArray(state)) return state as Record<string, unknown>
  return { state }
}

/** `Retry-After` is seconds or an HTTP date. Both are accepted. */
export function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (header.trim() !== "" && Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}
