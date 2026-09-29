import { describe, expect, it } from "vitest"

import { backoffMs } from "./queue"

/**
 * The backoff curve is worth pinning because it is the difference between a
 * provider outage resolving itself and a queue hammering a failing endpoint
 * until someone notices.
 */
describe("backoffMs", () => {
  it("grows exponentially from the first retry", () => {
    // Jitter is additive and capped at 25%, so each attempt has a known window.
    const windows = [
      { attempts: 1, min: 2_000, max: 2_500 },
      { attempts: 2, min: 4_000, max: 5_000 },
      { attempts: 3, min: 8_000, max: 10_000 },
      { attempts: 4, min: 16_000, max: 20_000 },
    ]
    for (const { attempts, min, max } of windows) {
      const delay = backoffMs(attempts)
      expect(delay, `attempt ${attempts}`).toBeGreaterThanOrEqual(min)
      expect(delay, `attempt ${attempts}`).toBeLessThanOrEqual(max)
    }
  })

  it("caps the delay so a job never disappears for hours", () => {
    // 2s doubling would reach several hours by attempt 20 without the ceiling.
    for (const attempts of [10, 20, 50]) {
      expect(backoffMs(attempts)).toBeLessThanOrEqual(10 * 60_000 * 1.25)
    }
  })

  it("adds jitter so simultaneous failures do not retry in lockstep", () => {
    const samples = new Set(Array.from({ length: 40 }, () => backoffMs(3)))
    // Without jitter every caller would compute the identical delay and
    // reproduce the thundering herd that caused the outage.
    expect(samples.size).toBeGreaterThan(1)
  })

  it("treats attempt 0 the same as the first attempt rather than collapsing to zero", () => {
    expect(backoffMs(0)).toBeGreaterThanOrEqual(2_000)
  })
})
