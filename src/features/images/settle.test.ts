import { describe, expect, it } from "vitest"

import { settleProjectStatus, type SettleContext } from "./orchestrator"
import { isTerminalImageState, statesAllowedBefore } from "./state-machine"

/**
 * Covers the fix for a project pinned at GENERATING forever.
 *
 * The old rule advanced a project only when EVERY image reached COMPLETED, so a
 * single failed frame stalled the run permanently: the UI never offered
 * evaluation or selection, and `ProjectStatus.FAILED` was unreachable anywhere
 * in the codebase. These cases pin the replacement rule down.
 */

type Counts = { inFlight: number; completed: number }

function context(counts: Counts) {
  const updates: { status: string }[] = []
  const transaction: SettleContext = {
    generatedImage: {
      async count(args: unknown) {
        const where = (args as { where: { status: { in?: string[] } | string } }).where
        // The in-flight probe passes `{ status: { in: [...] } }`; the success
        // probe passes `{ status: "COMPLETED" }`.
        return typeof where.status === "string" ? counts.completed : counts.inFlight
      },
    },
    project: {
      async update(args: unknown) {
        updates.push((args as { data: { status: string } }).data)
        return {}
      },
    },
  }
  return { transaction, updates }
}

describe("settleProjectStatus", () => {
  it("leaves the status alone while any image is still pending or generating", async () => {
    const { transaction, updates } = context({ inFlight: 1, completed: 3 })
    await settleProjectStatus(transaction, "project-1")
    expect(updates).toEqual([])
  })

  it("advances to IMAGES_READY when every image succeeded", async () => {
    const { transaction, updates } = context({ inFlight: 0, completed: 4 })
    await settleProjectStatus(transaction, "project-1")
    expect(updates).toEqual([{ status: "IMAGES_READY" }])
  })

  it("advances to IMAGES_READY on a partially successful run so the work stays usable", async () => {
    // Three of four frames rendered. This is the case that used to hang.
    const { transaction, updates } = context({ inFlight: 0, completed: 3 })
    await settleProjectStatus(transaction, "project-1")
    expect(updates).toEqual([{ status: "IMAGES_READY" }])
  })

  it("marks the project FAILED when nothing succeeded", async () => {
    const { transaction, updates } = context({ inFlight: 0, completed: 0 })
    await settleProjectStatus(transaction, "project-1")
    expect(updates).toEqual([{ status: "FAILED" }])
  })
})

describe("image state machine as a database guard", () => {
  it("only allows COMPLETED to be entered from GENERATING", () => {
    expect(statesAllowedBefore("COMPLETED")).toEqual(["GENERATING"])
  })

  it("only allows FAILED to be entered from GENERATING", () => {
    expect(statesAllowedBefore("FAILED")).toEqual(["GENERATING"])
  })

  it("allows PENDING from a failed row (retry) and from a generating row (lease recovery)", () => {
    // Lease recovery is the path that returns an abandoned claim to the queue
    // when a worker dies mid-render. Omitting GENERATING here would make the
    // graph disagree with the orchestrator.
    expect(statesAllowedBefore("PENDING").sort()).toEqual(["FAILED", "GENERATING"])
  })

  it("treats COMPLETED as terminal so a settled row is never rewritten", () => {
    expect(isTerminalImageState("COMPLETED")).toBe(true)
    expect(isTerminalImageState("GENERATING")).toBe(false)
  })
})
