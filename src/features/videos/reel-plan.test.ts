import { describe, expect, it } from "vitest"

import { planReel, shotDirection } from "./reel-plan"

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

describe("planReel", () => {
  it("covers 30 s with Veo's 8 s clips and crossfades", () => {
    const plan = planReel({ targetSeconds: 30, durations: [4, 6, 8], sceneCount: 2, lastFrame: true, transition: "CROSSFADE" })!
    expect(plan.clips.map((clip) => clip.seconds)).toEqual([8, 8, 8, 8])
    expect(plan.totalSeconds).toBe(30.5)
  })

  it("uses the fewest Kling clips and trims them to the target", () => {
    const plan = planReel({ targetSeconds: 30, durations: range(3, 15), sceneCount: 3, lastFrame: true, transition: "CROSSFADE" })!
    expect(plan.clips).toHaveLength(3)
    expect(plan.totalSeconds).toBeGreaterThanOrEqual(30)
    expect(plan.totalSeconds).toBeLessThan(31)
  })

  it("chains scenes so each clip closes where the next one opens", () => {
    const plan = planReel({ targetSeconds: 20, durations: range(3, 15), sceneCount: 3, lastFrame: true, transition: "DISSOLVE" })!
    expect(plan.clips.map((clip) => [clip.firstScene, clip.lastScene])).toEqual([[0, 1], [1, 2]])
  })

  it("does not plan when one render is enough, or when it would need too many cuts", () => {
    expect(planReel({ targetSeconds: 15, durations: range(4, 30), sceneCount: 1, lastFrame: false, transition: "CROSSFADE" })).toBeNull()
    expect(planReel({ targetSeconds: 30, durations: [4], sceneCount: 1, lastFrame: false, transition: "CROSSFADE" })).toBeNull()
  })

  it("hard cuts do not overlap", () => {
    const plan = planReel({ targetSeconds: 30, durations: range(5, 20), sceneCount: 1, lastFrame: false, transition: "NONE" })!
    expect(plan.totalSeconds).toBe(30)
    expect(plan.clips.every((clip) => clip.lastScene === null)).toBe(true)
  })
})

describe("shotDirection", () => {
  it("gives the first and last clips an opening hook and a product close", () => {
    expect(shotDirection(0, 3)).toMatch(/hook/)
    expect(shotDirection(2, 3)).toMatch(/close on the product/)
    expect(shotDirection(1, 3)).toMatch(/Shot 2 of 3/)
  })
})
