import { describe, expect, it } from "vitest"

import { chooseFit, findPreset, isMasterAspect, masterGeometry, SOCIAL_PRESETS } from "./presets"

describe("SOCIAL_PRESETS", () => {
  it("has a unique key per destination, since the key is stored on the render row", () => {
    const keys = SOCIAL_PRESETS.map((preset) => preset.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("uses only even dimensions, which H.264 4:2:0 requires", () => {
    // An odd dimension makes libx264 fail with "height not divisible by 2".
    for (const preset of SOCIAL_PRESETS) {
      expect(preset.width % 2, preset.key).toBe(0)
      expect(preset.height % 2, preset.key).toBe(0)
    }
  })

  it("states the aspect ratio its dimensions actually are", () => {
    for (const preset of SOCIAL_PRESETS) {
      const [w, h] = preset.aspectRatio.split(":").map(Number)
      expect(preset.width / preset.height, preset.key).toBeCloseTo(w / h, 2)
    }
  })
})

describe("chooseFit", () => {
  it("crops when the shapes are close", () => {
    // 9:16 to 4:5 keeps most of the frame, and Instagram would centre-crop it anyway.
    expect(chooseFit({ width: 1080, height: 1920 }, { width: 1080, height: 1350 })).toBe("cover")
  })

  it("pads when a crop would throw most of the frame away", () => {
    // A vertical master cropped to landscape keeps a sliver of the middle, which is
    // usually the part of the product nobody wants on its own.
    expect(chooseFit({ width: 1080, height: 1920 }, { width: 1920, height: 1080 })).toBe("contain")
  })

  it("crops for an identical shape, which is a no-op either way", () => {
    expect(chooseFit({ width: 1080, height: 1920 }, { width: 1080, height: 1920 })).toBe("cover")
  })

  it("lets a preset override the arithmetic", () => {
    // Some destinations have an opinion regardless of how much would be lost.
    expect(chooseFit({ width: 1080, height: 1920 }, { width: 1080, height: 1080, fit: "contain" })).toBe("contain")
  })

  it("pads rather than dividing by zero on a degenerate geometry", () => {
    expect(chooseFit({ width: 1080, height: 0 }, { width: 1080, height: 1080 })).toBe("contain")
  })

  it("is symmetric: a landscape master into vertical also pads", () => {
    expect(chooseFit({ width: 1920, height: 1080 }, { width: 1080, height: 1920 })).toBe("contain")
  })
})

describe("masterGeometry", () => {
  it("returns the dimensions for a known aspect", () => {
    expect(masterGeometry("16:9")).toMatchObject({ width: 1920, height: 1080 })
  })

  it("falls back to vertical for an unknown aspect rather than returning undefined", () => {
    // Vertical is the default the product is built around, and a caller reading
    // `.width` off undefined would fail far from the cause.
    expect(masterGeometry("21:9").aspectRatio).toBe("9:16")
  })
})

describe("findPreset and isMasterAspect", () => {
  it("finds a preset by key", () => {
    expect(findPreset("tiktok")?.height).toBe(1920)
  })

  it("returns undefined for an unknown key rather than a default", () => {
    // Silently substituting a preset would encode for the wrong destination.
    expect(findPreset("myspace")).toBeUndefined()
  })

  it("recognises the master aspects the editor offers", () => {
    expect(isMasterAspect("4:5")).toBe(true)
    expect(isMasterAspect("21:9")).toBe(false)
  })
})
