import type { Prisma } from "@/generated/prisma/client"
import type { DecisionKind } from "@/generated/prisma/enums"
import { getPrisma } from "@/lib/db/prisma"

import { resolveDecisionProvider } from "./runtime"
import {
  type AnswersOf,
  type DecisionAnswer,
  type DecisionBatch,
  type DecisionProvider,
  type DecisionQuestion,
} from "./types"

/**
 * The decision entry point.
 *
 * One call asks a whole batch of questions about one state and returns typed
 * answers, narrowed by the questions that were passed in — ask a `choice` with
 * three options and the answer's `choice` is a union of those three strings, not
 * `string`. That is the difference that matters at the call site: a new option
 * added to a question makes every `switch` over it fail to compile until it is
 * handled.
 *
 * Every answer is also written to the `Decision` table. Not for debugging: a
 * probabilistic gate that nobody can review after the fact is a gate nobody can
 * tune. The row records the question as it was asked, the distribution, which
 * backend answered and how long it took, so a threshold can be moved on evidence.
 */

export type DecideInput<Batch extends DecisionBatch> = {
  questions: Batch
  /** Named fields, because the question instructions refer to them by name. */
  state: Record<string, unknown>
  /** Audit linkage. Both optional: a decision can precede either. */
  projectId?: string | null
  agentRunId?: string | null
  /** Injected in tests, or to pin a backend for one call. */
  provider?: DecisionProvider
  /** Off for a decision that is genuinely throwaway. On by default. */
  persist?: boolean
}

export type DecideResult<Batch extends DecisionBatch> = {
  answers: AnswersOf<Batch>
  provider: string
  model: string
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
}

export async function decide<Batch extends DecisionBatch>(
  input: DecideInput<Batch>,
): Promise<DecideResult<Batch>> {
  const provider = input.provider ?? (await resolveDecisionProvider()).provider
  const result = await provider.evaluate({ state: input.state, questions: input.questions })

  if (input.persist !== false) {
    await persistDecisions({
      questions: input.questions,
      answers: result.answers,
      provider: provider.name,
      model: result.model,
      latencyMs: result.latencyMs,
      projectId: input.projectId ?? null,
      agentRunId: input.agentRunId ?? null,
    })
  }

  return {
    // The provider is contractually required to answer every question it was
    // given, and both adapters throw if one is missing, so the cast is the
    // narrowing the adapters already guaranteed at runtime.
    answers: result.answers as AnswersOf<Batch>,
    provider: provider.name,
    model: result.model,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  }
}

/**
 * Write the audit rows.
 *
 * Best-effort, like the generation logs: the answers have already been paid for
 * and the caller is about to act on them, so a failure to record them must not
 * throw that away. It is logged rather than swallowed silently, because a
 * decision history that quietly stops filling up looks identical to a product
 * that stopped making decisions.
 */
async function persistDecisions(input: {
  questions: DecisionBatch
  answers: Record<string, DecisionAnswer>
  provider: string
  model: string
  latencyMs: number
  projectId: string | null
  agentRunId: string | null
}) {
  const rows = Object.entries(input.answers).map(([key, answer]) => ({
    key,
    kind: kindOf(answer),
    instructions: renderQuestion(input.questions[key]),
    answer: answer as unknown as Prisma.InputJsonValue,
    confidence: answer.confidence,
    provider: input.provider,
    model: input.model,
    // The batch is the unit of work, so every answer in it shares the round trip
    // it came from. Per-answer latency does not exist to be measured.
    latencyMs: input.latencyMs,
    projectId: input.projectId,
    agentRunId: input.agentRunId,
  }))

  try {
    await getPrisma().decision.createMany({ data: rows })
  } catch (error) {
    console.error("DECISION_AUDIT_WRITE_FAILED", {
      keys: rows.map((row) => row.key),
      reason: error instanceof Error ? error.name : "unknown",
    })
  }
}

function kindOf(answer: DecisionAnswer): DecisionKind {
  if (answer.type === "noul") return "NOUL"
  if (answer.type === "choice") return "CHOICE"
  return "SCORE"
}

/**
 * Render a question as the text that was effectively asked.
 *
 * Criteria are folded into the stored text rather than dropped, because they are
 * half of what the question means: "is this urgent" with and without a definition
 * of urgent are two different classifiers, and an audit that only kept the first
 * line could not tell them apart.
 */
export function renderQuestion(question: DecisionQuestion | undefined): string {
  if (!question) return "(question not recorded)"

  if (question.type === "noul") {
    if (!question.criteria) return question.instructions
    return [question.instructions, `true: ${question.criteria.true}`, `false: ${question.criteria.false}`].join("\n")
  }

  if (question.type === "choice") {
    const options = Object.entries(question.criteria).map(([key, description]) => `${key}: ${description}`)
    return [question.instructions, ...options].join("\n")
  }

  const levels = question.criteria.map((label, index) => `${index}: ${label}`)
  return [question.instructions, ...levels].join("\n")
}

/** Recent decisions for a project, newest first. For the admin audit view. */
export function listProjectDecisions(projectId: string, take = 50) {
  return getPrisma().decision.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 200),
    select: {
      id: true,
      key: true,
      kind: true,
      instructions: true,
      answer: true,
      confidence: true,
      provider: true,
      model: true,
      latencyMs: true,
      createdAt: true,
    },
  })
}
