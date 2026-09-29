import { describe, expect, it } from "vitest"

import { serializeState, truncateText } from "./state"

/**
 * The state is assembled from things with no natural size limit — a transcript, a
 * scraped page, a list of directions — and both backends cap the context. What
 * matters is not that it shrinks but that it shrinks without changing what the
 * questions refer to.
 */

describe("serializeState", () => {
  it("passes a small state through untouched", () => {
    const state = { prompt: "a matte black bottle", palette: ["#07080A"] }
    const result = serializeState(state)
    expect(result.value).toBe(state)
    expect(result.truncated).toBe(false)
  })

  it("keeps every named field when it has to shrink", () => {
    // A question that asks about `page.body` must still find a `page.body`. An
    // absent field would be answered confidently and wrongly.
    const result = serializeState(
      {
        prompt: "a matte black bottle",
        page: { body: "lorem ipsum ".repeat(20_000), title: "Bottles" },
        palette: ["#07080A"],
      },
      500,
    )

    expect(result.truncated).toBe(true)
    expect(Object.keys(result.value)).toEqual(["prompt", "page", "palette"])
    const page = result.value.page as Record<string, unknown>
    expect(Object.keys(page)).toEqual(["body", "title"])
    expect(String(page.body).length).toBeLessThan(5_000)
  })

  it("does not shrink a short field away to make room for a long one", () => {
    const result = serializeState(
      { prompt: "a matte black bottle for trail runners", body: "x".repeat(100_000) },
      400,
    )
    // The user's own words are the highest-signal part of the state and must
    // survive a large page body landing next to them.
    expect(result.value.prompt).toBe("a matte black bottle for trail runners")
  })

  it("marks a truncated string so a reader knows it was cut", () => {
    const result = serializeState({ body: "x".repeat(50_000) }, 300)
    expect(String(result.value.body)).toContain("truncated")
  })

  it("trims a long array from the tail rather than mangling every element", () => {
    const result = serializeState({ pages: Array.from({ length: 400 }, (_, index) => `page ${index}`) }, 200)
    const pages = result.value.pages as string[]
    expect(pages.length).toBeLessThan(400)
    expect(pages[0]).toBe("page 0")
  })

  it("estimates the token cost so a caller can budget a batch", () => {
    const result = serializeState({ prompt: "a".repeat(360) })
    expect(result.estimatedTokens).toBeGreaterThan(80)
    expect(result.estimatedTokens).toBeLessThan(200)
  })

  it("survives a cycle, since state is assembled from ORM rows", () => {
    const state: Record<string, unknown> = { prompt: "a bottle" }
    state.self = state
    expect(() => serializeState(state)).not.toThrow()
  })
})

describe("truncateText", () => {
  it("leaves text within the limit alone", () => {
    expect(truncateText("short", 10)).toBe("short")
  })

  it("never returns more than the limit", () => {
    expect(truncateText("x".repeat(100), 20).length).toBe(20)
  })
})
