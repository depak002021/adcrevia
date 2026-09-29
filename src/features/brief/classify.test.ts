import { describe, expect, it, vi } from "vitest"

import { getPrisma } from "@/lib/db/prisma"
import type { DecisionAnswer, DecisionProvider } from "@/lib/decisions/types"

import { assessBrief, decisionState, derivePhase, generationGate } from "./classify"
import type { StoredMessage } from "./conversation"
import type { BriefState } from "./state"

vi.mock("@/lib/db/prisma", () => ({ getPrisma: vi.fn() }))

vi.mocked(getPrisma).mockReturnValue({
  decision: { createMany: vi.fn(async () => ({ count: 1 })) },
} as unknown as ReturnType<typeof getPrisma>)

/**
 * These are the judgements that used to be a field count. What is pinned here is
 * mostly the handling of "the classifier is not sure": an unconfident answer must
 * not round to a yes or a no, because both of those are decisions the product would
 * then make on no evidence.
 */

function state(overrides: Partial<BriefState> = {}): BriefState {
  return {
    projectId: "clh0000000000000000000000",
    phase: "DISCOVERY",
    completeness: 0,
    product: { prompt: "a matte black bottle", enhanced: null, facts: null, photos: { uploaded: 0, fromWebsite: 0 } },
    website: null,
    palette: [],
    directions: [],
    images: { target: 4, completed: 0, failed: 0 },
    hasVideo: false,
    ...overrides,
  }
}

function messages(): StoredMessage[] {
  return [
    {
      id: "m1",
      role: "USER",
      content: "a matte black bottle",
      toolName: null,
      toolCalls: null,
      toolResult: null,
      position: 1,
      createdAt: new Date(),
    },
    {
      id: "m2",
      role: "TOOL",
      content: '{"ok":true,"result":{"queued":true}}',
      toolName: "read_website",
      toolCalls: { callId: "call_1" },
      toolResult: { ok: true, userVisible: "Reading example.com" },
      position: 2,
      createdAt: new Date(),
    },
  ]
}

function noul(probability: number, confidence: number): DecisionAnswer {
  return { type: "noul", noul: probability, yes: probability >= 0.5, confidence, providerConfidence: null }
}

function briefProvider(options: {
  readyProbability: number
  readyConfidence: number
  missing?: { choice: string; confidence: number }
  depth?: number[]
}): DecisionProvider {
  const depth = options.depth ?? [0, 0, 0.2, 0.8, 0]
  return {
    name: "stub",
    evaluate: vi.fn(async () => ({
      answers: {
        brief_is_complete: noul(options.readyProbability, options.readyConfidence),
        missing_fact: {
          type: "choice" as const,
          choice: options.missing?.choice ?? "mood",
          probabilities: {},
          confidence: options.missing?.confidence ?? 0.6,
          providerConfidence: null,
        },
        brief_depth: {
          type: "score" as const,
          score: depth.reduce((sum, value, index) => sum + value * index, 0),
          probabilities: {},
          legend: {},
          confidence: 0.5,
          providerConfidence: null,
        },
      },
      model: "stub-1",
      latencyMs: 40,
      inputTokens: 100,
      outputTokens: 10,
    })),
  }
}

describe("assessBrief", () => {
  it("asks all three questions in one batch", async () => {
    const provider = briefProvider({ readyProbability: 0.9, readyConfidence: 0.8 })
    await assessBrief({ state: state(), messages: messages(), provider })

    // Both backends read the state once and answer in parallel; splitting this into
    // three calls would triple the latency of every turn for no extra information.
    expect(provider.evaluate).toHaveBeenCalledOnce()
    const batch = vi.mocked(provider.evaluate).mock.calls[0][0].questions
    expect(Object.keys(batch)).toEqual(["brief_is_complete", "missing_fact", "brief_depth"])
  })

  it("opens the gate on a confident yes above the threshold", async () => {
    const result = await assessBrief({
      state: state(),
      messages: messages(),
      provider: briefProvider({ readyProbability: 0.9, readyConfidence: 0.8 }),
    })
    expect(result.ready).toBe(true)
  })

  it("reports unknown rather than yes when the answer is not confident", async () => {
    // 0.9 is above the 0.7 threshold, but a margin of 0.05 means the backend is
    // guessing, and a guess must not spend provider credits.
    const result = await assessBrief({
      state: state(),
      messages: messages(),
      provider: briefProvider({ readyProbability: 0.9, readyConfidence: 0.05 }),
    })
    expect(result.ready).toBeNull()
  })

  it("holds the gate shut for a confident probability below the threshold", async () => {
    const result = await assessBrief({
      state: state(),
      messages: messages(),
      provider: briefProvider({ readyProbability: 0.6, readyConfidence: 0.9 }),
    })
    // The threshold is 0.7 precisely because "more likely than not" is too weak a
    // basis for starting a paid run.
    expect(result.ready).toBe(false)
  })

  it("maps the depth score onto the 0-100 meter the UI shows", async () => {
    const result = await assessBrief({
      state: state(),
      messages: messages(),
      // All the mass on the top of a five-level scale.
      provider: briefProvider({ readyProbability: 0.9, readyConfidence: 0.8, depth: [0, 0, 0, 0, 1] }),
    })
    expect(result.completeness).toBe(100)
  })

  it("reports no missing fact when the classifier says nothing is missing", async () => {
    const result = await assessBrief({
      state: state(),
      messages: messages(),
      provider: briefProvider({
        readyProbability: 0.9,
        readyConfidence: 0.8,
        missing: { choice: "nothing_material", confidence: 0.9 },
      }),
    })
    // `nothing_material` is the classifier saying there is no gap, not naming one.
    expect(result.missingFact).toBeNull()
  })

  it("withholds a missing fact it is not confident about", async () => {
    const result = await assessBrief({
      state: state(),
      messages: messages(),
      provider: briefProvider({
        readyProbability: 0.3,
        readyConfidence: 0.8,
        missing: { choice: "mood", confidence: 0.02 },
      }),
    })
    expect(result.missingFact).toBeNull()
  })
})

describe("decisionState", () => {
  it("shows the classifier the conversation but not the tool plumbing", () => {
    const assembled = decisionState(state(), messages())
    const transcript = assembled.conversation as Array<{ role: string }>
    // Tool output is already reflected in the structured state; including it twice
    // lets a long crawl result crowd out the user's own words.
    expect(transcript).toHaveLength(1)
    expect(transcript[0].role).toBe("user")
  })

  it("passes the user's own words through verbatim", () => {
    expect(decisionState(state(), messages()).product_prompt).toBe("a matte black bottle")
  })
})

describe("derivePhase", () => {
  it("asks which product before anything else when the site found several", () => {
    const phase = derivePhase({
      state: state({
        website: {
          url: "https://example.com",
          title: null,
          brandName: "Example",
          products: [
            { name: "Bottle", description: null, url: null, price: null },
            { name: "Flask", description: null, url: null, price: null },
          ],
          palette: [],
          logo: null,
          analyzed: true,
          safeErrorCode: null,
          primaryProduct: false,
        },
        directions: [{ position: 1, title: "Studio", mood: "calm" }],
      }),
      assessment: { ready: true },
      productConfirmed: false,
    })
    // A complete brief about the wrong product is the expensive mistake, so this
    // outranks a high completeness score.
    expect(phase).toBe("PRODUCT_CONFIRM")
  })

  it("does not ask which product when the link is that product's own page", () => {
    const phase = derivePhase({
      state: state({
        website: {
          url: "https://example.com/products/bottle",
          title: null,
          brandName: "Example",
          products: [
            { name: "Bottle", description: null, url: null, price: null },
            { name: "Flask", description: null, url: null, price: null },
          ],
          palette: [],
          logo: null,
          analyzed: true,
          safeErrorCode: null,
          primaryProduct: true,
        },
        directions: [{ position: 1, title: "Studio", mood: "calm" }],
      }),
      assessment: { ready: true },
      productConfirmed: false,
    })
    expect(phase).toBe("READY")
  })

  it("moves to READY once the product is confirmed and the brief is ready", () => {
    const phase = derivePhase({
      state: state({
        website: {
          url: "https://example.com",
          title: null,
          brandName: "Example",
          products: [{ name: "Bottle", description: null, url: null, price: null }],
          palette: [],
          logo: null,
          analyzed: true,
          safeErrorCode: null,
          primaryProduct: false,
        },
      }),
      assessment: { ready: true },
      productConfirmed: true,
    })
    expect(phase).toBe("READY")
  })

  it("sits in DIRECTION while directions exist but the brief is not ready", () => {
    const phase = derivePhase({
      state: state({ directions: [{ position: 1, title: "Studio", mood: "calm" }] }),
      assessment: { ready: false },
      productConfirmed: true,
    })
    expect(phase).toBe("DIRECTION")
  })

  it("stays in DISCOVERY when nothing has been established", () => {
    expect(derivePhase({ state: state(), assessment: { ready: null }, productConfirmed: false })).toBe("DISCOVERY")
  })
})

describe("generationGate", () => {
  it("allows generation on a confident yes", () => {
    expect(generationGate({ ready: true, missingFact: null })).toEqual({ allowed: true })
  })

  it("names the missing fact so the agent can ask about exactly that", () => {
    const gate = generationGate({ ready: false, missingFact: "physical_detail" })
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toContain("material")
  })

  it("refuses when readiness is unknown rather than gambling on credits", () => {
    const gate = generationGate({ ready: null, missingFact: null })
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toContain("not clear")
  })

  it("still refuses usefully when no specific fact could be named", () => {
    const gate = generationGate({ ready: false, missingFact: null })
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toContain("one focused question")
  })
})
