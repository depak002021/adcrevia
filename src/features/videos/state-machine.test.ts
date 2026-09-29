import { describe, expect, it } from "vitest"

import { isTerminalVideoState, statesAllowedBefore } from "./state-machine"

/**
 * These assertions exist because the graph now drives the `where` clause of the
 * status updates in the video repository. A wrong entry here is not a
 * documentation error — it silently makes a legitimate update match zero rows,
 * which Prisma reports as a missing record.
 */
describe("video state machine as a database guard", () => {
  it("allows FAILED from either PENDING or PROCESSING", () => {
    // The refresh path fails a row that is mid-render, so PROCESSING must be
    // present or a provider failure could never be recorded.
    expect(statesAllowedBefore("FAILED")).toEqual(["PENDING", "PROCESSING"])
  })

  it("allows COMPLETED only from PROCESSING", () => {
    expect(statesAllowedBefore("COMPLETED")).toEqual(["PROCESSING"])
  })

  it("lists only PENDING as a predecessor of PROCESSING", () => {
    // Rows are created directly as PROCESSING, so the repository has to add the
    // self-allowance explicitly. This pins the reason that is necessary: the
    // graph alone does not permit a PROCESSING row to be re-affirmed.
    expect(statesAllowedBefore("PROCESSING")).toEqual(["PENDING"])
    expect(statesAllowedBefore("PROCESSING")).not.toContain("PROCESSING")
  })

  it("treats COMPLETED as terminal", () => {
    expect(isTerminalVideoState("COMPLETED")).toBe(true)
    expect(isTerminalVideoState("PROCESSING")).toBe(false)
  })
})
