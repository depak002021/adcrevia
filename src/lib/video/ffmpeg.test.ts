import { describe, expect, it } from "vitest"

import { parseFrameRate, parseProgress } from "./ffmpeg"

/**
 * The `-progress` format is stable but undocumented, and its units are a trap. Both
 * of these are pinned because the symptom of getting them wrong is a progress bar
 * that runs to 100,000% or a frame rate of zero, neither of which points at the cause.
 */

describe("parseProgress", () => {
  const block = [
    "frame=120",
    "fps=30.1",
    "bitrate=4200.0kbits/s",
    "total_size=1048576",
    "out_time_us=4000000",
    "out_time_ms=4000000",
    "out_time=00:00:04.000000",
    "speed=1.42x",
  ].join("\n")

  it("reads out_time_ms as microseconds, despite the name", () => {
    // ffmpeg's `out_time_ms` is microseconds. Treating it as milliseconds overstates
    // progress by a factor of a thousand.
    expect(parseProgress(block)?.outTimeMs).toBe(4_000)
  })

  it("reports a fraction of the expected duration when one is known", () => {
    expect(parseProgress(block, 10_000)?.fraction).toBeCloseTo(0.4, 5)
  })

  it("never reports more than complete", () => {
    // The final block can overshoot slightly; a bar past 100% looks broken.
    expect(parseProgress(block, 3_000)?.fraction).toBe(1)
  })

  it("leaves the fraction null when the duration is unknown", () => {
    expect(parseProgress(block)?.fraction).toBeNull()
  })

  it("reads the encoding speed, which is how a slow host shows itself", () => {
    expect(parseProgress(block)?.speed).toBeCloseTo(1.42, 5)
  })

  it("returns null for a block with no timestamp in it", () => {
    expect(parseProgress("frame=0\nfps=0.0")).toBeNull()
  })

  it("falls back to out_time_us when out_time_ms is absent", () => {
    expect(parseProgress("out_time_us=2500000")?.outTimeMs).toBe(2_500)
  })

  it("ignores a timestamp that is not a number", () => {
    expect(parseProgress("out_time_ms=N/A")).toBeNull()
  })

  it("tolerates a speed ffmpeg could not compute", () => {
    expect(parseProgress("out_time_ms=1000000\nspeed=N/A")?.speed).toBeNull()
  })
})

describe("parseFrameRate", () => {
  it("evaluates the rational ffprobe reports", () => {
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2)
    expect(parseFrameRate("30/1")).toBe(30)
  })

  it("accepts a bare number", () => {
    expect(parseFrameRate("24")).toBe(24)
  })

  it("returns zero rather than Infinity for the 0/0 a stream with no frames reports", () => {
    // A zero here becomes the caller's default; an Infinity becomes an fps filter
    // argument that makes ffmpeg fail with an unhelpful message.
    expect(parseFrameRate("0/0")).toBe(0)
    expect(parseFrameRate(undefined)).toBe(0)
    expect(parseFrameRate("nonsense")).toBe(0)
  })
})
