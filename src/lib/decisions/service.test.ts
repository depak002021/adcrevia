import { afterEach, describe, expect, it, vi } from "vitest"

import { getPrisma } from "@/lib/db/prisma"
import { decide, renderQuestion } from "./service"
import type { DecisionBatch, DecisionProvider } from "./types"

vi.mock("@/lib/db/prisma", () => ({ getPrisma: vi.fn() }))

const mockedGetPrisma = vi.mocked(getPrisma)

const questions = {
  brief_is_complete: {
    type: "noul",
    instructions: "Is the brief complete?",
    criteria: { true: "Everything needed is present", false: "A defining attribute is missing" },
  },
  missing_fact: {
    type: "choice",
    instructions: "What is missing?",
    criteria: { mood: "Mood is unstated", audience: "Audience is unstated" },
  },
} satisfies DecisionBatch

function stubProvider(name = "typesafe"): DecisionProvider {
  return {
    name,
    evaluate: vi.fn(async () => ({
      answers: {
        brief_is_complete: {
          type: "noul" as const,
          noul: 0.9,
          yes: true,
          confidence: 0.8,
          providerConfidence: null,
        },
        missing_fact: {
          type: "choice" as const,
          choice: "mood",
          probabilities: { mood: 0.7, audience: 0.3 },
          confidence: 0.4,
          providerConfidence: 0.55,
        },
      },
      model: "jev-1.13.0",
      latencyMs: 92,
      inputTokens: 410,
      outputTokens: 38,
    })),
  }
}

function prismaHarness(options?: { failWrites?: boolean }) {
  const createMany = vi.fn(async ({ data }: { data: unknown[] }) => {
    if (options?.failWrites) throw new Error("connection terminated")
    return { count: data.length }
  })
  mockedGetPrisma.mockReturnValue({ decision: { createMany } } as unknown as ReturnType<typeof getPrisma>)
  return { createMany }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("decide", () => {
  it("returns the backend's answers along with which backend produced them", async () => {
    prismaHarness()
    const result = await decide({ questions, state: { prompt: "a bottle" }, provider: stubProvider() })

    expect(result.provider).toBe("typesafe")
    expect(result.model).toBe("jev-1.13.0")
    expect(result.latencyMs).toBe(92)
    expect(result.answers.brief_is_complete.noul).toBe(0.9)
    expect(result.answers.missing_fact.choice).toBe("mood")
  })

  it("writes one audit row per answer", async () => {
    const { createMany } = prismaHarness()
    await decide({
      questions,
      state: { prompt: "a bottle" },
      projectId: "project_1",
      agentRunId: "run_1",
      provider: stubProvider(),
    })

    expect(createMany).toHaveBeenCalledOnce()
    const rows = createMany.mock.calls[0][0].data as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.key)).toEqual(["brief_is_complete", "missing_fact"])
    expect(rows.map((row) => row.kind)).toEqual(["NOUL", "CHOICE"])
    expect(rows.every((row) => row.projectId === "project_1" && row.agentRunId === "run_1")).toBe(true)
  })

  it("records the confidence the code branched on, not the backend's own number", async () => {
    const { createMany } = prismaHarness()
    await decide({ questions, state: {}, provider: stubProvider() })

    const rows = createMany.mock.calls[0][0].data as Array<{ key: string; confidence: number; answer: unknown }>
    const choice = rows.find((row) => row.key === "missing_fact")
    expect(choice?.confidence).toBe(0.4)
    // The backend's value is still in the stored answer, so a calibration
    // question can be answered later from the history.
    expect(choice?.answer).toMatchObject({ providerConfidence: 0.55 })
  })

  it("stores the criteria with the question, because they are half of what it asked", async () => {
    const { createMany } = prismaHarness()
    await decide({ questions, state: {}, provider: stubProvider() })

    const rows = createMany.mock.calls[0][0].data as Array<{ key: string; instructions: string }>
    const gate = rows.find((row) => row.key === "brief_is_complete")
    expect(gate?.instructions).toContain("Is the brief complete?")
    expect(gate?.instructions).toContain("true: Everything needed is present")
    expect(gate?.instructions).toContain("false: A defining attribute is missing")
  })

  it("still returns the answers when the audit write fails", async () => {
    // The answers have been paid for and the caller is about to act on them.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    prismaHarness({ failWrites: true })

    const result = await decide({ questions, state: {}, provider: stubProvider() })

    expect(result.answers.brief_is_complete.yes).toBe(true)
    // Logged, not swallowed: a decision history that quietly stops filling up
    // looks exactly like a product that stopped making decisions.
    expect(consoleError).toHaveBeenCalledWith("DECISION_AUDIT_WRITE_FAILED", expect.anything())
    consoleError.mockRestore()
  })

  it("skips persistence entirely when asked to", async () => {
    const { createMany } = prismaHarness()
    await decide({ questions, state: {}, provider: stubProvider(), persist: false })
    expect(createMany).not.toHaveBeenCalled()
  })

  it("passes the state through to the backend unchanged", async () => {
    prismaHarness()
    const provider = stubProvider()
    await decide({ questions, state: { prompt: "a bottle", palette: ["#000000"] }, provider })
    expect(provider.evaluate).toHaveBeenCalledWith({
      state: { prompt: "a bottle", palette: ["#000000"] },
      questions,
    })
  })
})

describe("renderQuestion", () => {
  it("renders a score question with its levels numbered as the backend sees them", () => {
    const rendered = renderQuestion({
      type: "score",
      instructions: "How deep is the brief?",
      criteria: ["Empty", "Thin", "Complete"],
    })
    expect(rendered).toBe("How deep is the brief?\n0: Empty\n1: Thin\n2: Complete")
  })

  it("renders a noul without criteria as just its instructions", () => {
    expect(renderQuestion({ type: "noul", instructions: "Is it ready?" })).toBe("Is it ready?")
  })

  it("says so rather than inventing text when the question is not available", () => {
    expect(renderQuestion(undefined)).toBe("(question not recorded)")
  })
})
