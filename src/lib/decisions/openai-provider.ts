import OpenAI from "openai"
import { zodTextFormat } from "openai/helpers/zod"
import { z } from "zod"
import { reasoningFor } from "@/lib/ai/reasoning"

import {
  argmax,
  expectedLevel,
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
} from "./types"

/**
 * OpenAI structured-output backend, emulating the decision contract.
 *
 * This is the default, because it needs no key the product does not already have.
 * It is slower and dearer than a purpose-built decision model, but it means the
 * agentic brief works out of the box and a Jev key is an upgrade rather than a
 * prerequisite.
 *
 * Two things make the emulation actually interchangeable rather than merely
 * type-compatible:
 *
 *  - Every question in the batch goes in one request, as with Jev, so latency and
 *    token cost do not scale with the number of judgements.
 *  - The model is asked only for probability distributions, and the score,
 *    confidence and selection are all computed from those by the same shared
 *    functions the Jev adapter uses. A threshold therefore means the same thing
 *    whichever backend answered.
 *
 * The request schema carries no numeric or array constraints on purpose. A schema
 * can pin an array's length; it cannot make the numbers inside it sum to 1, which is
 * the property that actually matters here — so the checks have to happen after
 * parsing regardless, and leaving `minItems`/`maximum` out keeps the adapter usable
 * against fine-tuned models, where that subset is still rejected.
 */

const DEFAULT_MODEL = "gpt-5-mini"

const INSTRUCTIONS = [
  "You are a calibrated classifier. You do not write prose, explain yourself, or add commentary.",
  "You are given one `state` and a list of `questions`. Answer every question independently against the same state.",
  "For a `noul` question, return `probability`: the probability between 0 and 1 that the statement is true.",
  "For a `choice` question, return `choice` (exactly one of the supplied option keys) and `probabilities`: one value per option, in the exact order the options were listed.",
  "For a `score` question, return `probabilities`: one value per level, in the exact order the levels were listed, lowest level first.",
  "Every `probabilities` array must have exactly one entry per option or level and must sum to 1.",
  "Be calibrated, not decisive: when the state genuinely does not settle a question, spread the probability. A confident answer that is wrong is far worse than an uncertain one.",
].join(" ")

export type OpenAIDecisionOptions = {
  apiKey: string
  model?: string
  /** Injected in tests. Only the `responses.parse` call is used. */
  client?: Pick<OpenAI["responses"], "parse">
}

export class OpenAIDecisionProvider implements DecisionProvider {
  readonly name = "openai"

  private readonly model: string
  private readonly responses: Pick<OpenAI["responses"], "parse">

  constructor(options: OpenAIDecisionOptions) {
    if (!options.client && !options.apiKey) {
      throw new DecisionError("DECISION_PROVIDER_NOT_CONFIGURED", "openai api key missing")
    }
    this.model = options.model ?? DEFAULT_MODEL
    this.responses = options.client ?? new OpenAI({ apiKey: options.apiKey }).responses
  }

  async evaluate(input: { state: unknown; questions: DecisionBatch }): Promise<DecisionProviderResult> {
    const ids = Object.keys(input.questions)
    if (ids.length === 0) throw new DecisionError("DECISION_ANSWER_INVALID", "empty question batch")

    const state = serializeState(asStateObject(input.state))
    const startedAt = Date.now()

    // `.catch` rather than try/catch so the inferred result type survives, and so
    // only the transport failure is wrapped — a bad answer shape is a different
    // error with a different meaning.
    const result = await this.responses
      .parse({
        model: this.model,
        instructions: INSTRUCTIONS,
        ...reasoningFor(this.model, "minimal"),
        input: JSON.stringify({ state: state.value, questions: describeQuestions(input.questions) }),
        text: { format: zodTextFormat(batchSchema(input.questions), "adcrevia_decisions") },
      })
      .catch((error: unknown) => {
        throw new DecisionError(
          "DECISION_PROVIDER_UNAVAILABLE",
          `openai ${error instanceof Error ? error.name : "error"}`,
        )
      })

    const parsed = result.output_parsed as { answers: Record<string, RawAnswer> } | null | undefined
    if (!parsed?.answers) throw new DecisionError("DECISION_ANSWER_INVALID", "openai returned no parsed output")

    const answers: Record<string, DecisionAnswer> = {}
    for (const id of ids) {
      answers[id] = normalizeRawAnswer(id, input.questions[id], parsed.answers[id])
    }

    return {
      answers,
      model: typeof result.model === "string" ? result.model : this.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: result.usage?.input_tokens ?? null,
      outputTokens: result.usage?.output_tokens ?? null,
    }
  }
}

type RawAnswer = { probability?: number; choice?: string; probabilities?: number[] }

/** One zod object per question, keyed by question id, wrapped in `answers`. */
function batchSchema(questions: DecisionBatch) {
  const shape: Record<string, z.ZodType> = {}
  for (const [id, question] of Object.entries(questions)) {
    shape[id] =
      question.type === "noul"
        ? z.object({ probability: z.number() })
        : question.type === "choice"
          ? z.object({ choice: z.string(), probabilities: z.array(z.number()) })
          : z.object({ probabilities: z.array(z.number()) })
  }
  return z.object({ answers: z.object(shape) })
}

/**
 * Restate the batch for the model.
 *
 * Option keys and level labels are sent as ordered arrays as well as inside
 * `criteria`, because the answer is an array aligned to that order and "the order
 * the options were listed" has to refer to something unambiguous.
 */
function describeQuestions(questions: DecisionBatch) {
  return Object.entries(questions).map(([id, question]) => {
    if (question.type === "noul") {
      return { id, type: question.type, instructions: question.instructions, criteria: question.criteria ?? null }
    }
    if (question.type === "choice") {
      return {
        id,
        type: question.type,
        instructions: question.instructions,
        options: Object.keys(question.criteria),
        criteria: question.criteria,
      }
    }
    return {
      id,
      type: question.type,
      instructions: question.instructions,
      levels: question.criteria,
    }
  })
}

/**
 * Turn one model answer into the internal shape.
 *
 * Forgiving where Jev is strict, because there is no schema that can force a
 * language model to return a distribution of the right length or a `choice` from
 * the declared set. A short or missing distribution degrades to uniform, which
 * yields zero confidence and sends the caller down its fallback path — the
 * correct outcome for an answer that told us nothing.
 */
export function normalizeRawAnswer(
  id: string,
  question: DecisionBatch[string],
  answer: RawAnswer | undefined,
): DecisionAnswer {
  if (!answer) throw new DecisionError("DECISION_ANSWER_INVALID", `missing answer for ${id}`)

  if (question.type === "noul") {
    if (typeof answer.probability !== "number") {
      throw new DecisionError("DECISION_ANSWER_INVALID", `missing probability for ${id}`)
    }
    const distribution = normalizeDistribution([answer.probability, 1 - answer.probability])
    return {
      type: "noul",
      noul: roundProbability(distribution[0]),
      yes: distribution[0] >= 0.5,
      confidence: marginConfidence(distribution),
      providerConfidence: null,
    }
  }

  if (question.type === "choice") {
    const keys = Object.keys(question.criteria)
    const distribution = alignedDistribution(answer.probabilities, keys.length)
    // Prefer the model's stated pick, and fall back to the peak of its own
    // distribution when it named an option that was never offered.
    const stated = answer.choice ? keys.indexOf(answer.choice) : -1
    const selected = stated >= 0 ? stated : argmax(distribution)
    return {
      type: "choice",
      choice: keys[selected],
      probabilities: keyedProbabilities(keys, distribution),
      // Negative when the stated pick is not the peak, which clamps to zero and
      // routes a self-contradicting answer to the fallback.
      confidence: selectionConfidence(distribution, selected),
      providerConfidence: null,
    }
  }

  const levels = question.criteria
  const distribution = alignedDistribution(answer.probabilities, levels.length)
  return {
    type: "score",
    score: roundScore(expectedLevel(distribution)),
    probabilities: indexedProbabilities(distribution),
    legend: legendFrom(levels),
    confidence: marginConfidence(distribution),
    providerConfidence: null,
  }
}

/**
 * Force a returned distribution to the expected length.
 *
 * A wrong length means the alignment between values and options is unknowable, so
 * the values are discarded rather than shifted into the wrong slots — reading a
 * probability against the wrong option is worse than admitting ignorance.
 */
function alignedDistribution(values: number[] | undefined, length: number): number[] {
  if (!values || values.length !== length) return new Array(length).fill(1 / Math.max(1, length))
  return normalizeDistribution(values)
}

function asStateObject(state: unknown): Record<string, unknown> {
  if (state && typeof state === "object" && !Array.isArray(state)) return state as Record<string, unknown>
  return { state }
}
