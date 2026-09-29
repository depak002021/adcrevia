import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { defineTool, type AnyAgentTool } from "@/lib/agent/types"
import { getPrisma } from "@/lib/db/prisma"
import type { DecisionAnswer, DecisionProvider } from "@/lib/decisions/types"

import type { StoredMessage } from "./conversation"
import { createBriefGuardrail } from "./guardrail"
import type { BriefState } from "./state"

vi.mock("@/lib/db/prisma", () => ({ getPrisma: vi.fn() }))

vi.mocked(getPrisma).mockReturnValue({
  decision: { createMany: vi.fn(async () => ({ count: 1 })) },
} as unknown as ReturnType<typeof getPrisma>)

/**
 * The asymmetry between tools is the design being tested here, not an accident:
 * spending credits requires a confident yes, while a cheap reversible action is
 * blocked only by a confident no. Collapsing the two — either way — is what makes a
 * guardrail either useless or infuriating.
 */

function state(): BriefState {
  return {
    projectId: "clh0000000000000000000000",
    phase: "DISCOVERY",
    completeness: 40,
    product: { prompt: "a matte black bottle", enhanced: null, facts: null, photos: { uploaded: 0, fromWebsite: 0 } },
    website: null,
    palette: [],
    directions: [],
    images: { target: 4, completed: 0, failed: 0 },
    hasVideo: false,
  }
}

const messages: StoredMessage[] = []

function noul(probability: number, confidence: number): DecisionAnswer {
  return { type: "noul", noul: probability, yes: probability >= 0.5, confidence, providerConfidence: null }
}

/** Answers whichever question it is handed, from a fixed table. */
function provider(answers: Record<string, DecisionAnswer>): DecisionProvider {
  return {
    name: "stub",
    evaluate: vi.fn(async ({ questions }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          answers[key] ??
            ({
              type: "choice",
              choice: "mood",
              probabilities: {},
              confidence: 0.6,
              providerConfidence: null,
            } as DecisionAnswer),
        ]),
      ),
      model: "stub-1",
      latencyMs: 30,
      inputTokens: 80,
      outputTokens: 8,
    })),
  }
}

function briefAnswers(readyProbability: number, readyConfidence: number): Record<string, DecisionAnswer> {
  return {
    brief_is_complete: noul(readyProbability, readyConfidence),
    brief_depth: {
      type: "score",
      score: 2,
      probabilities: {},
      legend: {},
      confidence: 0.5,
      providerConfidence: null,
    },
  }
}

function tool(name: string, guarded = true): AnyAgentTool {
  return defineTool({
    name,
    description: name,
    input: z.object({ url: z.string().optional() }),
    guarded,
    execute: async () => ({ ok: true as const, output: {} }),
  })
}

function guardrail(answers: Record<string, DecisionAnswer>) {
  const decisionProvider = provider(answers)
  return {
    decisionProvider,
    preflight: createBriefGuardrail({ state: state(), messages, agentRunId: "run_1", provider: decisionProvider }),
  }
}

describe("createBriefGuardrail", () => {
  it("lets generation through on a confident yes", async () => {
    const { preflight } = guardrail(briefAnswers(0.92, 0.85))
    await expect(preflight(tool("start_generation"), {})).resolves.toEqual({ allowed: true })
  })

  it("refuses generation when readiness is unknown", async () => {
    // Uncertainty costs a sentence to resolve; a wasted run costs money.
    const { preflight } = guardrail(briefAnswers(0.92, 0.04))
    const decision = await preflight(tool("start_generation"), {})
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBeDefined()
  })

  it("refuses generation on a confident no", async () => {
    const { preflight } = guardrail(briefAnswers(0.15, 0.7))
    await expect(preflight(tool("start_generation"), {})).resolves.toMatchObject({ allowed: false })
  })

  it("allows directions when readiness is merely unknown", async () => {
    // Directions are cheap and thrown away freely, and showing the user something
    // to react to is often the fastest way to find out what they want.
    const { preflight } = guardrail(briefAnswers(0.5, 0.01))
    await expect(preflight(tool("propose_directions"), {})).resolves.toEqual({ allowed: true })
  })

  it("blocks directions only on a confident no", async () => {
    const { preflight } = guardrail(briefAnswers(0.1, 0.8))
    const decision = await preflight(tool("propose_directions"), {})
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain("one focused question")
  })

  it("does not classify readiness for a tool that only records a fact", async () => {
    const { preflight, decisionProvider } = guardrail(briefAnswers(0.1, 0.9))
    await expect(preflight(tool("record_brief"), {})).resolves.toEqual({ allowed: true })
    // No classifier can tell whether a fact the user just stated is worth writing
    // down, and a decision call here would tax every turn.
    expect(decisionProvider.evaluate).not.toHaveBeenCalled()
  })

  it("classifies readiness once per invocation, not once per tool call", async () => {
    const { preflight, decisionProvider } = guardrail(briefAnswers(0.92, 0.85))
    await preflight(tool("propose_directions"), {})
    await preflight(tool("start_generation"), {})
    expect(decisionProvider.evaluate).toHaveBeenCalledOnce()
  })

  it("gates a website read on whether the URL looks like the brand's own site", async () => {
    const { preflight, decisionProvider } = guardrail({ url_is_safe_to_fetch: noul(0.95, 0.9) })
    await expect(
      preflight(tool("read_website"), { url: "https://example.com" }),
    ).resolves.toEqual({ allowed: true })
    const asked = vi.mocked(decisionProvider.evaluate).mock.calls[0][0].questions
    // Readiness is the wrong question here: reading a site is exactly how an empty
    // brief gets filled.
    expect(Object.keys(asked)).toEqual(["url_is_safe_to_fetch"])
  })

  it("refuses a URL the classifier is confident is not the product's site", async () => {
    const { preflight } = guardrail({ url_is_safe_to_fetch: noul(0.05, 0.9) })
    const decision = await preflight(tool("read_website"), { url: "https://bit.ly/x" })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain("does not look like")
  })

  it("allows an uncertain URL, because the address checks still apply at fetch time", async () => {
    // A classifier must never be the load-bearing control; `safeFetch` resolves DNS
    // and rejects private addresses regardless of what is decided here.
    const { preflight } = guardrail({ url_is_safe_to_fetch: noul(0.55, 0.02) })
    await expect(
      preflight(tool("read_website"), { url: "https://unknown-brand.example" }),
    ).resolves.toEqual({ allowed: true })
  })

  it("refuses a website read with no URL at all instead of classifying nothing", async () => {
    const { preflight, decisionProvider } = guardrail({})
    const decision = await preflight(tool("read_website"), {})
    expect(decision.allowed).toBe(false)
    expect(decisionProvider.evaluate).not.toHaveBeenCalled()
  })

  it("allows a tool it has no rule for", async () => {
    // A new guarded tool must not be silently unreachable because nobody added it
    // to the table; ownership and validation still apply inside the tool itself.
    const { preflight } = guardrail(briefAnswers(0.1, 0.9))
    await expect(preflight(tool("some_future_tool"), {})).resolves.toEqual({ allowed: true })
  })
})
