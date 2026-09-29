import { describe, expect, it } from "vitest"

import { providerSupportsAspectRatio, videoInputSchema } from "./schemas"

const base = {
  projectId: "clx1234567890abcdefghijk",
  prompt: "Slow cinematic orbit with soft reflections",
  motionStyle: "CINEMATIC" as const,
  aspectRatio: "16:9" as const,
}

describe("videoInputSchema duration", () => {
  // The schema admits the union of every model's range (Seedance 2.5 goes to 30 s);
  // each model's own range is enforced by durationRangeFor in the service.
  it.each([3, 4, 5, 20, 30])("accepts whole duration %i", (duration) => {
    expect(videoInputSchema.safeParse({ ...base, duration }).success).toBe(true)
  })

  it.each([2, 31, 7.5])("rejects duration %s", (duration) => {
    expect(videoInputSchema.safeParse({ ...base, duration }).success).toBe(false)
  })
})

describe("videoInputSchema aspect ratio union", () => {
  it.each(["16:9", "9:16", "1:1", "4:5", "4:3", "3:4"])("accepts supported ratio %s", (aspectRatio) => {
    expect(videoInputSchema.safeParse({ ...base, duration: 5, aspectRatio }).success).toBe(true)
  })

  it("rejects an unsupported ratio", () => {
    expect(videoInputSchema.safeParse({ ...base, duration: 5, aspectRatio: "21:9" }).success).toBe(false)
  })
})

describe("providerSupportsAspectRatio", () => {
  it("BFL supports 4:3 and 3:4 but not 4:5", () => {
    expect(providerSupportsAspectRatio("bfl", "4:3")).toBe(true)
    expect(providerSupportsAspectRatio("bfl", "3:4")).toBe(true)
    expect(providerSupportsAspectRatio("bfl", "4:5")).toBe(false)
  })

  it("Runway supports 4:5 but not 4:3 or 3:4", () => {
    expect(providerSupportsAspectRatio("runway", "4:5")).toBe(true)
    expect(providerSupportsAspectRatio("runway", "4:3")).toBe(false)
    expect(providerSupportsAspectRatio("runway", "3:4")).toBe(false)
  })

  it("both providers support the common ratios", () => {
    for (const ratio of ["16:9", "9:16", "1:1"] as const) {
      expect(providerSupportsAspectRatio("bfl", ratio)).toBe(true)
      expect(providerSupportsAspectRatio("runway", ratio)).toBe(true)
    }
  })
})

describe("durationRangeFor", () => {
  it("keeps Runway and FLUX at 5-20 seconds", async () => {
    const { durationRangeFor } = await import("./schemas")
    expect(durationRangeFor("runway")).toEqual({ min: 5, max: 20 })
    expect(durationRangeFor("bfl", "flux-3-video")).toEqual({ min: 5, max: 20 })
  })

  it("follows each Seedance model's own limit", async () => {
    const { durationRangeFor } = await import("./schemas")
    expect(durationRangeFor("seedance", "dreamina-seedance-2-5-260628")).toEqual({ min: 4, max: 30 })
    expect(durationRangeFor("seedance", "dreamina-seedance-2-0-fast-260128")).toEqual({ min: 4, max: 15 })
  })
})
