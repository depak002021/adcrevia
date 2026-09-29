import { describe, expect, it } from "vitest"

import { expectedReelMs, expectedVideoMs, median, REEL_JOIN_MS } from "./expected"

describe("expected render times", () => {
  it("takes the median of real runs, ignoring gaps", () => {
    expect(median([60_000, 40_000, 50_000])).toBe(50_000)
    expect(median([40_000, 60_000])).toBe(50_000)
    expect(median([])).toBeNull()
  })

  it("prefers measured history over defaults, and defaults over a generic guess", () => {
    const times = { images: {}, videos: { "kling-3.0-turbo": 451_000 } }
    expect(expectedVideoMs(times, "kling-3.0-turbo")).toBe(451_000)
    expect(expectedVideoMs(null, "veo-3.1-lite-generate-preview")).toBe(50_000)
    expect(expectedVideoMs(null, "unknown-model")).toBe(180_000)
  })

  it("adds the join to a reel, whose clips render in parallel", () => {
    expect(expectedReelMs(null, "veo-3.1-lite-generate-preview")).toBe(50_000 + REEL_JOIN_MS)
  })
})
