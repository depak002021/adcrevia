import { describe, expect, it } from "vitest"

import {
  clampTrim,
  formatBytes,
  formatDuration,
  isDirty,
  moveClip,
  timelineClipDurationMs,
  timelineDurationMs,
  type TimelineClip,
} from "./timeline"

import { buildCompositionGraph } from "@/lib/video/filter-graph"

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    videoId: "clh0000000000000000000000",
    trimInMs: 0,
    trimOutMs: null,
    transition: "CROSSFADE",
    transitionMs: 500,
    speed: 1,
    sourceDurationMs: 5_000,
    ...overrides,
  }
}

describe("timelineDurationMs", () => {
  /**
   * The point of this test is not the arithmetic, which `filter-graph` already covers.
   * It is that the editor and the renderer agree: two implementations of "clips minus
   * overlaps" drift, and the symptom is somebody arranging a 15-second edit and getting
   * 14.2 back with nothing to explain it.
   */
  it("matches what the renderer will actually produce", () => {
    const clips = [
      clip({ trimOutMs: 3_000 }),
      clip({ videoId: "b", transition: "NONE", sourceDurationMs: 4_000 }),
      clip({ videoId: "c", speed: 1.5, sourceDurationMs: 6_000 }),
    ]

    const plan = buildCompositionGraph({
      clips: clips.map((entry) => ({ ...entry, path: "/tmp/x.mp4", hasAudio: false })),
      canvas: { width: 1080, height: 1920, fps: 30, loudnessTarget: -14 },
      outputPath: "/tmp/out.mp4",
    })

    expect(timelineDurationMs(clips, 30)).toBe(plan.durationMs)
  })

  it("shortens as a trim handle moves", () => {
    const before = timelineDurationMs([clip(), clip({ videoId: "b" })], 30)
    const after = timelineDurationMs([clip({ trimOutMs: 2_000 }), clip({ videoId: "b" })], 30)
    expect(after).toBeLessThan(before)
  })
})

describe("timelineClipDurationMs", () => {
  it("reports the trimmed, speed-adjusted length", () => {
    expect(timelineClipDurationMs(clip({ trimInMs: 1_000, trimOutMs: 5_000, speed: 2 }))).toBe(2_000)
  })
})

describe("moveClip", () => {
  it("moves a clip one place later", () => {
    expect(moveClip(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"])
  })

  it("moves a clip one place earlier", () => {
    expect(moveClip(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"])
  })

  it("returns the same order at either end rather than wrapping", () => {
    // Wrapping would make the last clip jump to the front on a mis-tap, which is the
    // kind of edit nobody notices until they watch the render.
    expect(moveClip(["a", "b"], 0, -1)).toEqual(["a", "b"])
    expect(moveClip(["a", "b"], 1, 1)).toEqual(["a", "b"])
  })

  it("does not mutate the array it was given", () => {
    const original = ["a", "b"]
    moveClip(original, 0, 1)
    expect(original).toEqual(["a", "b"])
  })
})

describe("clampTrim", () => {
  it("keeps the out point inside the source", () => {
    expect(clampTrim(clip({ trimOutMs: 9_000 })).trimOutMs).toBe(5_000)
  })

  it("keeps at least 200ms of clip", () => {
    // A zero-length input makes xfade read past the end of a stream, which freezes a
    // frame instead of failing.
    const clamped = clampTrim(clip({ trimInMs: 4_000, trimOutMs: 4_000 }))
    expect((clamped.trimOutMs ?? 0) - clamped.trimInMs).toBeGreaterThanOrEqual(200)
  })

  it("never lets the in point reach the end of the source", () => {
    expect(clampTrim(clip({ trimInMs: 9_999 })).trimInMs).toBe(4_800)
  })

  it("leaves an open-ended clip open", () => {
    expect(clampTrim(clip()).trimOutMs).toBeNull()
  })
})

describe("isDirty", () => {
  it("is false for an identical arrangement", () => {
    expect(isDirty([clip()], [clip()])).toBe(false)
  })

  it("notices a reorder", () => {
    expect(isDirty([clip({ videoId: "b" }), clip()], [clip(), clip({ videoId: "b" })])).toBe(true)
  })

  it("notices a changed transition, trim or speed", () => {
    expect(isDirty([clip({ transition: "NONE" })], [clip()])).toBe(true)
    expect(isDirty([clip({ trimInMs: 500 })], [clip()])).toBe(true)
    expect(isDirty([clip({ speed: 2 })], [clip()])).toBe(true)
  })

  it("notices a removed clip", () => {
    expect(isDirty([clip()], [clip(), clip({ videoId: "b" })])).toBe(true)
  })

  it("ignores the source duration, which is not part of the edit", () => {
    // It comes from the provider's metadata and can differ between reads; treating it
    // as an edit would show unsaved changes the user never made.
    expect(isDirty([clip({ sourceDurationMs: 4_800 })], [clip({ sourceDurationMs: 5_000 })])).toBe(false)
  })
})

describe("formatDuration", () => {
  it("uses seconds below a minute", () => {
    expect(formatDuration(12_400)).toBe("12.4s")
  })

  it("switches to minutes and pads the seconds", () => {
    expect(formatDuration(64_200)).toBe("1:04.2")
  })

  it("treats a negative as zero rather than printing a minus", () => {
    expect(formatDuration(-500)).toBe("0.0s")
  })
})

describe("formatBytes", () => {
  it("uses megabytes for a rendered file", () => {
    expect(formatBytes(4_404_019)).toBe("4.2 MB")
  })

  it("drops to kilobytes below a megabyte", () => {
    expect(formatBytes(204_800)).toBe("200 KB")
  })

  it("returns null when there is no size to show", () => {
    expect(formatBytes(null)).toBeNull()
    expect(formatBytes(0)).toBeNull()
  })
})
