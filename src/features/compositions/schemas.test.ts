import { describe, expect, it } from "vitest"

import { compositionInput, exportInput, validateClipWindows, type CompositionClipInput } from "./schemas"

/**
 * These bounds are not defensive decoration. `transitionMs` becomes an ffmpeg filter
 * argument, `speed` becomes an `atempo` value, and a trim window becomes a `-t` on an
 * input — each has a real limit, and exceeding it produces an unhelpful ffmpeg error
 * minutes into a render instead of a 400 the user can act on.
 */

function clip(overrides: Partial<CompositionClipInput> = {}): CompositionClipInput {
  return {
    videoId: "clh0000000000000000000000",
    trimInMs: 0,
    trimOutMs: null,
    transition: "CROSSFADE",
    transitionMs: 500,
    speed: 1,
    ...overrides,
  }
}

const projectId = "clh0000000000000000000001"

describe("compositionInput", () => {
  it("fills in the defaults a minimal timeline omits", () => {
    const parsed = compositionInput.parse({
      projectId,
      clips: [{ videoId: "clh0000000000000000000000" }],
    })
    expect(parsed.aspectRatio).toBe("9:16")
    expect(parsed.fps).toBe(30)
    expect(parsed.clips[0]).toMatchObject({ transition: "CROSSFADE", transitionMs: 500, speed: 1, trimInMs: 0 })
  })

  it("refuses an empty timeline", () => {
    expect(compositionInput.safeParse({ projectId, clips: [] }).success).toBe(false)
  })

  it("caps the clip count at the image selection limit", () => {
    // The edit is built from the selection tray, which allows ten.
    const clips = Array.from({ length: 11 }, () => clip())
    expect(compositionInput.safeParse({ projectId, clips }).success).toBe(false)
  })

  it("rejects a speed atempo cannot handle in one pass", () => {
    // Beyond 0.5-2 the audio degrades audibly and needs chained stages.
    expect(compositionInput.safeParse({ projectId, clips: [clip({ speed: 3 })] }).success).toBe(false)
    expect(compositionInput.safeParse({ projectId, clips: [clip({ speed: 0.2 })] }).success).toBe(false)
  })

  it("rejects a transition longer than two seconds", () => {
    expect(compositionInput.safeParse({ projectId, clips: [clip({ transitionMs: 5_000 })] }).success).toBe(false)
  })

  it("rejects an aspect ratio there is no master geometry for", () => {
    expect(compositionInput.safeParse({ projectId, aspectRatio: "21:9", clips: [clip()] }).success).toBe(false)
  })

  it("rejects a frame rate outside the three the presets assume", () => {
    expect(compositionInput.safeParse({ projectId, fps: 60, clips: [clip()] }).success).toBe(false)
  })
})

describe("validateClipWindows", () => {
  it("accepts an open-ended clip", () => {
    expect(validateClipWindows([clip()])).toEqual({ ok: true })
  })

  it("rejects an inverted trim window", () => {
    const result = validateClipWindows([clip({ trimInMs: 3_000, trimOutMs: 1_000 })])
    expect(result).toEqual({ ok: false, reason: "CLIP_1_TRIM_WINDOW_EMPTY" })
  })

  it("rejects a zero-length clip", () => {
    // A zero-length input makes xfade read past the end of a stream, which freezes a
    // frame rather than failing.
    expect(validateClipWindows([clip({ trimInMs: 1_000, trimOutMs: 1_000 })]).ok).toBe(false)
  })

  it("names which clip is wrong, since the timeline can hold ten", () => {
    const result = validateClipWindows([clip(), clip({ trimInMs: 500, trimOutMs: 100 })])
    expect(result).toEqual({ ok: false, reason: "CLIP_2_TRIM_WINDOW_EMPTY" })
  })

  it("rejects the same source twice", () => {
    // The schema enforces it as well; catching it here turns a mid-transaction
    // constraint violation into a message.
    expect(validateClipWindows([clip(), clip()])).toEqual({ ok: false, reason: "CLIP_REPEATED" })
  })
})

describe("exportInput", () => {
  it("accepts known destinations", () => {
    expect(exportInput.parse({ presets: ["reels", "youtube"] }).presets).toEqual(["reels", "youtube"])
  })

  it("rejects a destination with no preset behind it", () => {
    expect(exportInput.safeParse({ presets: ["myspace"] }).success).toBe(false)
  })

  it("requires at least one destination", () => {
    expect(exportInput.safeParse({ presets: [] }).success).toBe(false)
  })
})
