import { describe, expect, it, vi } from "vitest"

import { OpenAIDecisionProvider } from "./openai-provider"
import type { DecisionBatch } from "./types"

/**
 * The OpenAI backend is an emulation, so what matters is not that it answers but
 * that it answers on the same scale as Jev. A threshold written against one
 * backend has to keep its meaning against the other, and these tests are the only
 * thing holding that true.
 */

const questions = {
  brief_is_complete: { type: "noul", instructions: "Is the brief complete?" },
  missing_fact: {
    type: "choice",
    instructions: "What is missing?",
    criteria: { product_identity: "unclear product", mood: "unstated mood", nothing_material: "nothing missing" },
  },
  brief_depth: {
    type: "score",
    instructions: "How deep is the brief?",
    criteria: ["Empty", "Thin", "Workable", "Complete"],
  },
} satisfies DecisionBatch

type ParseArgs = { model: string; instructions: string; input: string; text: unknown }

function providerWith(parsed: unknown, options?: { model?: string; usage?: unknown }) {
  const parse = vi.fn(async (_args: ParseArgs) => ({
    output_parsed: parsed,
    model: options?.model ?? "gpt-5-mini-2026-01-01",
    usage: options?.usage ?? { input_tokens: 512, output_tokens: 64 },
  }))
  const provider = new OpenAIDecisionProvider({
    apiKey: "sk-test",
    client: { parse } as unknown as ConstructorParameters<typeof OpenAIDecisionProvider>[0]["client"],
  })
  return { provider, parse }
}

const wellFormed = {
  answers: {
    brief_is_complete: { probability: 0.82 },
    missing_fact: { choice: "mood", probabilities: [0.1, 0.75, 0.15] },
    brief_depth: { probabilities: [0, 0.04, 0.8, 0.16] },
  },
}

describe("OpenAIDecisionProvider", () => {
  it("asks the whole batch in a single request", async () => {
    const { provider, parse } = providerWith(wellFormed)
    await provider.evaluate({ state: { prompt: "a bottle" }, questions })

    // Latency and token cost must not scale with the number of judgements.
    expect(parse).toHaveBeenCalledOnce()
    const payload = JSON.parse(parse.mock.calls[0][0].input)
    expect(payload.questions.map((question: { id: string }) => question.id)).toEqual([
      "brief_is_complete",
      "missing_fact",
      "brief_depth",
    ])
    expect(payload.state).toEqual({ prompt: "a bottle" })
  })

  it("sends the option order explicitly, because the answer is aligned to it", async () => {
    const { provider, parse } = providerWith(wellFormed)
    await provider.evaluate({ state: {}, questions })

    const payload = JSON.parse(parse.mock.calls[0][0].input)
    const choice = payload.questions.find((question: { id: string }) => question.id === "missing_fact")
    expect(choice.options).toEqual(["product_identity", "mood", "nothing_material"])
    const score = payload.questions.find((question: { id: string }) => question.id === "brief_depth")
    expect(score.levels).toEqual(["Empty", "Thin", "Workable", "Complete"])
  })

  it("derives the same answer shape the Jev backend produces", async () => {
    const { provider } = providerWith(wellFormed)
    const result = await provider.evaluate({ state: {}, questions })

    const complete = result.answers.brief_is_complete
    if (complete.type !== "noul") throw new Error("unreachable")
    expect(complete.noul).toBeCloseTo(0.82, 4)
    expect(complete.yes).toBe(true)
    expect(complete.confidence).toBeCloseTo(0.64, 4)
    // OpenAI reports no confidence of its own, and inventing one would be a lie.
    expect(complete.providerConfidence).toBeNull()

    const missing = result.answers.missing_fact
    if (missing.type !== "choice") throw new Error("unreachable")
    expect(missing.choice).toBe("mood")
    expect(missing.probabilities).toEqual({ product_identity: 0.1, mood: 0.75, nothing_material: 0.15 })
    expect(missing.confidence).toBeCloseTo(0.6, 4)

    const depth = result.answers.brief_depth
    if (depth.type !== "score") throw new Error("unreachable")
    // 1*0.04 + 2*0.8 + 3*0.16 = 2.12, the same expectation Jev reports in `score`.
    expect(depth.score).toBeCloseTo(2.12, 4)
    expect(depth.legend).toEqual({ 0: "Empty", 1: "Thin", 2: "Workable", 3: "Complete" })
  })

  it("reports the model that actually answered and its token usage", async () => {
    const { provider } = providerWith(wellFormed, { model: "gpt-5-mini-2026-01-01" })
    const result = await provider.evaluate({ state: {}, questions })
    expect(result.model).toBe("gpt-5-mini-2026-01-01")
    expect(result.inputTokens).toBe(512)
    expect(result.outputTokens).toBe(64)
  })

  it("falls back to the peak when the model names an option that was never offered", async () => {
    const { provider } = providerWith({
      answers: {
        ...wellFormed.answers,
        missing_fact: { choice: "budget", probabilities: [0.2, 0.7, 0.1] },
      },
    })
    const result = await provider.evaluate({ state: {}, questions })
    const missing = result.answers.missing_fact
    if (missing.type !== "choice") throw new Error("unreachable")
    // Being forgiving is right here: unlike a wire contract, no schema can force
    // a language model to stay inside the declared option set.
    expect(missing.choice).toBe("mood")
  })

  it("gives zero confidence when the stated pick contradicts its own distribution", async () => {
    const { provider } = providerWith({
      answers: {
        ...wellFormed.answers,
        missing_fact: { choice: "product_identity", probabilities: [0.1, 0.8, 0.1] },
      },
    })
    const result = await provider.evaluate({ state: {}, questions })
    const missing = result.answers.missing_fact
    if (missing.type !== "choice") throw new Error("unreachable")
    expect(missing.choice).toBe("product_identity")
    // Zero confidence routes the caller to its fallback instead of acting on a
    // self-contradicting answer.
    expect(missing.confidence).toBe(0)
  })

  it("discards a distribution of the wrong length rather than misaligning it", async () => {
    const { provider } = providerWith({
      answers: {
        ...wellFormed.answers,
        // Three levels returned for a four-level question. Shifting these into
        // the wrong slots would read a probability against the wrong label.
        brief_depth: { probabilities: [0.1, 0.2, 0.7] },
      },
    })
    const result = await provider.evaluate({ state: {}, questions })
    const depth = result.answers.brief_depth
    if (depth.type !== "score") throw new Error("unreachable")
    expect(depth.confidence).toBe(0)
    expect(depth.score).toBeCloseTo(1.5, 4)
  })

  it("rejects a missing probability instead of reading it as a no", async () => {
    const { provider } = providerWith({
      answers: { ...wellFormed.answers, brief_is_complete: {} },
    })
    await expect(provider.evaluate({ state: {}, questions })).rejects.toMatchObject({
      code: "DECISION_ANSWER_INVALID",
    })
  })

  it("rejects a response the model failed to parse into the schema", async () => {
    const { provider } = providerWith(null)
    await expect(provider.evaluate({ state: {}, questions })).rejects.toMatchObject({
      code: "DECISION_ANSWER_INVALID",
    })
  })

  it("refuses an empty batch instead of paying for a request with no questions", async () => {
    const { provider, parse } = providerWith(wellFormed)
    await expect(provider.evaluate({ state: {}, questions: {} })).rejects.toMatchObject({
      code: "DECISION_ANSWER_INVALID",
    })
    expect(parse).not.toHaveBeenCalled()
  })
})
