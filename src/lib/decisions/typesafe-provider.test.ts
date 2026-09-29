import { describe, expect, it, vi } from "vitest"

import { retryAfterMs, TypeSafeDecisionProvider } from "./typesafe-provider"
import { DecisionError, type DecisionBatch } from "./types"

/**
 * The fixtures here are TypeSafe's own published example payloads, so these tests
 * pin the adapter against the documented contract rather than against my reading
 * of it. If the wire format moves, this is where it shows up.
 *
 * Reference: https://developers.cloudflare.com/ai/models/typesafe/jev/
 */

const questions = {
  is_urgent: {
    type: "noul",
    instructions: "Does this convey urgency?",
    criteria: { true: "Explicitly time-sensitive", false: "No urgency expressed" },
  },
  department: {
    type: "choice",
    instructions: "Which team should handle this?",
    criteria: {
      billing: "Payments, invoicing, refunds",
      technical: "Bugs, outages, integrations",
      sales: "Pricing, upgrades, new accounts",
    },
  },
  frustration: {
    type: "score",
    instructions: "How frustrated is the customer?",
    criteria: ["Calm", "Frustrated", "Very angry"],
  },
} satisfies DecisionBatch

const publishedResponse = {
  model: "jev-1.13.0",
  answers: {
    is_urgent: { type: "noul", noul: 0.95 },
    department: {
      type: "choice",
      choice: "billing",
      confidence: 0.8,
      probabilities: { billing: 0.87, sales: 0, technical: 0.13 },
    },
    frustration: {
      type: "score",
      score: 1.04,
      confidence: 0.94,
      legend: { 0: "Calm", 1: "Frustrated", 2: "Very angry" },
      probabilities: { 0: 0, 1: 0.96, 2: 0.04 },
    },
  },
  usage: { input_tokens: 426, output_tokens: 73 },
}

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...init?.headers },
  })
}

function providerWith(fetchImpl: typeof fetch) {
  return new TypeSafeDecisionProvider({ apiKey: "jev_test_key", fetchImpl })
}

describe("TypeSafeDecisionProvider", () => {
  it("sends one request carrying the whole batch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(publishedResponse)) as unknown as typeof fetch
    await providerWith(fetchImpl).evaluate({ state: { ticket: "Help!" }, questions })

    // One round trip for three judgements is the entire reason this layer exists.
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]
    expect(url).toBe("https://api.typesafe.ai/v1/systemone")
    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe("jev-latest")
    expect(Object.keys(body.questions)).toEqual(["is_urgent", "department", "frustration"])
    expect(body.state).toEqual({ ticket: "Help!" })
  })

  it("authenticates with a bearer token and asks for JSON", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(publishedResponse)) as unknown as typeof fetch
    await providerWith(fetchImpl).evaluate({ state: { ticket: "Help!" }, questions })

    const headers = vi.mocked(fetchImpl).mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer jev_test_key")
    expect(headers["content-type"]).toBe("application/json")
  })

  it("normalises the published response into typed answers", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(publishedResponse)) as unknown as typeof fetch
    const result = await providerWith(fetchImpl).evaluate({ state: { ticket: "Help!" }, questions })

    expect(result.model).toBe("jev-1.13.0")
    expect(result.inputTokens).toBe(426)
    expect(result.outputTokens).toBe(73)

    const urgent = result.answers.is_urgent
    expect(urgent.type).toBe("noul")
    if (urgent.type !== "noul") throw new Error("unreachable")
    expect(urgent.noul).toBeCloseTo(0.95, 4)
    expect(urgent.yes).toBe(true)
    expect(urgent.confidence).toBeCloseTo(0.9, 4)

    const department = result.answers.department
    if (department.type !== "choice") throw new Error("unreachable")
    expect(department.choice).toBe("billing")
    expect(department.probabilities).toEqual({ billing: 0.87, technical: 0.13, sales: 0 })
    expect(department.confidence).toBeCloseTo(0.74, 4)
    // The backend's own number is kept for audit but is not what code branches on.
    expect(department.providerConfidence).toBe(0.8)

    const frustration = result.answers.frustration
    if (frustration.type !== "score") throw new Error("unreachable")
    expect(frustration.score).toBe(1.04)
    expect(frustration.legend).toEqual({ 0: "Calm", 1: "Frustrated", 2: "Very angry" })
    expect(frustration.providerConfidence).toBe(0.94)
  })

  it("keys choice probabilities to the declared option order, not the response order", async () => {
    // The published response lists sales before technical. Code that zipped the
    // response's own key order onto the declared options would swap them.
    const fetchImpl = vi.fn(async () => jsonResponse(publishedResponse)) as unknown as typeof fetch
    const result = await providerWith(fetchImpl).evaluate({ state: {}, questions })
    const department = result.answers.department
    if (department.type !== "choice") throw new Error("unreachable")
    expect(Object.keys(department.probabilities)).toEqual(["billing", "technical", "sales"])
  })

  it("rejects an answer whose type does not match the question", async () => {
    // Reading `answer.noul` off a choice answer yields undefined, which would
    // become a confident-looking false rather than an error.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        answers: {
          is_urgent: { type: "choice", choice: "billing", probabilities: { billing: 1 } },
          department: publishedResponse.answers.department,
          frustration: publishedResponse.answers.frustration,
        },
      }),
    ) as unknown as typeof fetch

    await expect(providerWith(fetchImpl).evaluate({ state: {}, questions })).rejects.toMatchObject({
      code: "DECISION_ANSWER_INVALID",
    })
  })

  it("rejects a choice the question never offered", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        answers: {
          ...publishedResponse.answers,
          department: { type: "choice", choice: "legal", probabilities: { billing: 1 } },
        },
      }),
    ) as unknown as typeof fetch

    await expect(providerWith(fetchImpl).evaluate({ state: {}, questions })).rejects.toMatchObject({
      code: "DECISION_ANSWER_INVALID",
    })
  })

  it("rejects a batch that came back with a question missing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ answers: { is_urgent: publishedResponse.answers.is_urgent } }),
    ) as unknown as typeof fetch

    await expect(providerWith(fetchImpl).evaluate({ state: {}, questions })).rejects.toMatchObject({
      code: "DECISION_ANSWER_INVALID",
    })
  })

  it("surfaces a rate limit with the interval the backend asked for", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "slow down" }, { status: 429, headers: { "retry-after": "12" } }),
    ) as unknown as typeof fetch

    const error = await providerWith(fetchImpl)
      .evaluate({ state: {}, questions })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DecisionError)
    expect(error).toMatchObject({ code: "DECISION_RATE_LIMITED", retryAfterMs: 12_000 })
  })

  it("reports an error status without echoing the response body", async () => {
    const secretish = "prompt containing Bearer sk-live-should-never-be-logged"
    const fetchImpl = vi.fn(async () => jsonResponse({ error: secretish }, { status: 500 })) as unknown as typeof fetch

    const error = await providerWith(fetchImpl)
      .evaluate({ state: {}, questions })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: "DECISION_PROVIDER_UNAVAILABLE" })
    expect(String((error as Error).message)).not.toContain("sk-live")
  })

  it("treats a network failure as unavailable rather than as a bad answer", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch

    await expect(providerWith(fetchImpl).evaluate({ state: {}, questions })).rejects.toMatchObject({
      code: "DECISION_PROVIDER_UNAVAILABLE",
    })
  })

  it("refuses an empty batch instead of paying for a request with no questions", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    await expect(providerWith(fetchImpl).evaluate({ state: {}, questions: {} })).rejects.toMatchObject({
      code: "DECISION_ANSWER_INVALID",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("requires a credential at construction rather than failing mid-conversation", () => {
    expect(() => new TypeSafeDecisionProvider({ apiKey: "" })).toThrow(DecisionError)
  })
})

describe("retryAfterMs", () => {
  it("reads a seconds value", () => {
    expect(retryAfterMs("30")).toBe(30_000)
  })

  it("reads an HTTP date", () => {
    const future = new Date(Date.now() + 5_000).toUTCString()
    expect(retryAfterMs(future)).toBeGreaterThan(3_000)
  })

  it("never returns a negative wait for a date already in the past", () => {
    expect(retryAfterMs(new Date(Date.now() - 60_000).toUTCString())).toBe(0)
  })

  it("returns undefined when the header is absent or unusable", () => {
    expect(retryAfterMs(null)).toBeUndefined()
    expect(retryAfterMs("soon")).toBeUndefined()
    expect(retryAfterMs("")).toBeUndefined()
  })
})
