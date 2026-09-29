/**
 * Contracts for the decision layer.
 *
 * A "decision" is a small, typed judgement about some state: is this brief
 * complete, is this the product the user meant, is this image on brand. The
 * application used to make those judgements by asking a chat model for prose and
 * then guessing at the prose, or — worse — by comparing strings (the directions
 * check compared a Set of lowercased titles and called that "distinct").
 *
 * Here a question declares its shape up front and the answer comes back typed,
 * with a probability distribution attached. Control flow then reads a number
 * rather than parsing a sentence, and every answer is auditable after the fact.
 *
 * The three question types mirror TypeSafe's Jev model, which is the fast
 * backend this layer is designed for. OpenAI structured output is emulated
 * against the same contract so the product works with no Jev key configured.
 */

/** Yes/no. The answer is the probability that the statement is true. */
export type NoulQuestion = {
  type: "noul"
  instructions: string
  /**
   * Boundary cases. Optional, but supplying both sides is what stops a noul
   * drifting: "urgent" means nothing until you say what is and is not urgent.
   */
  criteria?: { true: string; false: string }
}

/** One of a fixed set. `criteria` maps each option key to when it applies. */
export type ChoiceQuestion<Option extends string = string> = {
  type: "choice"
  instructions: string
  criteria: Record<Option, string>
}

/** Position on an ordered scale. `criteria` is lowest level first. */
export type ScoreQuestion = {
  type: "score"
  instructions: string
  criteria: readonly string[]
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion

/** A batch of questions, keyed by a stable id, answered against one state. */
export type DecisionBatch = Record<string, DecisionQuestion>

export type NoulAnswer = {
  type: "noul"
  /** Probability the statement is true, 0..1. */
  noul: number
  /**
   * The plain reading of the probability: `noul >= 0.5`. Policy thresholds are
   * deliberately NOT applied here — a gate that needs 0.75 says so at the call
   * site, where the cost of being wrong is known.
   */
  yes: boolean
  /** Comparable across backends. See `confidence.ts`. */
  confidence: number
  /** The backend's own confidence, when it reports one. Audit only. */
  providerConfidence: number | null
}

export type ChoiceAnswer<Option extends string = string> = {
  type: "choice"
  choice: Option
  /** One entry per declared option, normalised to sum to 1. */
  probabilities: Record<Option, number>
  confidence: number
  providerConfidence: number | null
}

export type ScoreAnswer = {
  type: "score"
  /**
   * Expectation over the level distribution, on the `0 .. levels-1` scale.
   * Continuous on purpose: "1.84 out of 0..2" carries information that the
   * nearest label does not.
   */
  score: number
  /** Level index (as a string key) to probability. */
  probabilities: Record<string, number>
  /** Level index to its label, so a stored answer is readable without the question. */
  legend: Record<string, string>
  confidence: number
  providerConfidence: number | null
}

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer

/** Maps a question to the answer it produces. */
export type AnswerOf<Question> = Question extends { type: "noul" }
  ? NoulAnswer
  : Question extends { type: "choice"; criteria: Record<infer Option extends string, string> }
    ? ChoiceAnswer<Option>
    : Question extends { type: "score" }
      ? ScoreAnswer
      : never

export type AnswersOf<Batch extends DecisionBatch> = { [Key in keyof Batch]: AnswerOf<Batch[Key]> }

export type DecisionUsage = {
  model: string
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
}

export type DecisionProviderResult = {
  answers: Record<string, DecisionAnswer>
} & DecisionUsage

/**
 * A decision backend.
 *
 * `evaluate` takes the whole batch because that is the unit both backends are
 * efficient at: Jev reads the state once and answers every question against it
 * in parallel, and a single structured-output call does the same for OpenAI.
 * Asking one question at a time would multiply both the latency and the bill by
 * the number of questions.
 */
export interface DecisionProvider {
  /** Recorded on every persisted decision, so a backend change is visible. */
  readonly name: string
  evaluate(input: { state: unknown; questions: DecisionBatch }): Promise<DecisionProviderResult>
}

export type DecisionErrorCode =
  /** Backend refused the request or is down. Retryable. */
  | "DECISION_PROVIDER_UNAVAILABLE"
  /** Rate limited. `retryAfterMs` is set when the backend said when to return. */
  | "DECISION_RATE_LIMITED"
  /** The backend answered, but not with the shape that was asked for. */
  | "DECISION_ANSWER_INVALID"
  /** No backend is configured at all. Not retryable. */
  | "DECISION_PROVIDER_NOT_CONFIGURED"

export class DecisionError extends Error {
  constructor(
    readonly code: DecisionErrorCode,
    /** Operator-facing detail. Never a response body and never a credential. */
    readonly detail?: string,
    readonly retryAfterMs?: number,
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = "DecisionError"
  }
}
