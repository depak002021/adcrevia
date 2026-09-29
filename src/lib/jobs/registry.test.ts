import { afterEach, describe, expect, it, vi } from "vitest"

import { registerHandler, resetHandlersForTest, runJob } from "./registry"
import { PermanentJobError, type ClaimedJob, type JobContext } from "./types"

function context(job: Partial<ClaimedJob> = {}): JobContext {
  return {
    job: {
      id: "job-1",
      kind: "IMAGE_EVALUATE",
      payload: { projectId: "clh0000000000000000000000" },
      attempts: 1,
      maxAttempts: 3,
      projectId: null,
      ...job,
    } as ClaimedJob,
    report: vi.fn(async () => {}),
    heartbeat: vi.fn(async () => {}),
    signal: new AbortController().signal,
  }
}

afterEach(() => resetHandlersForTest())

describe("runJob", () => {
  it("validates the stored payload before the handler sees it", async () => {
    const handler = vi.fn(async () => {})
    registerHandler("IMAGE_EVALUATE", handler)

    // A payload written by an older deploy, missing a field the schema requires.
    await expect(runJob(context({ payload: { wrong: true } }))).rejects.toMatchObject({
      safeErrorCode: "INVALID_JOB_PAYLOAD",
    })
    // The handler must never run on a payload it cannot trust.
    expect(handler).not.toHaveBeenCalled()
  })

  it("rejects a bad payload permanently rather than retrying it", async () => {
    registerHandler("IMAGE_EVALUATE", async () => {})
    // Retrying cannot fix a malformed payload, so it must not consume attempts.
    await expect(runJob(context({ payload: {} }))).rejects.toBeInstanceOf(PermanentJobError)
  })

  it("passes the parsed payload to the handler", async () => {
    const handler = vi.fn(async () => {})
    registerHandler("IMAGE_EVALUATE", handler)

    const projectId = "clh0000000000000000000000"
    await runJob(context({ payload: { projectId, extra: "ignored" } }))

    // Parsed, so unknown keys are stripped and the handler gets exactly the
    // shape its schema promises.
    expect(handler).toHaveBeenCalledWith(
      { projectId },
      expect.objectContaining({ report: expect.any(Function) }),
    )
  })

  it("fails loudly for a kind with no handler instead of reporting success", async () => {
    // Kinds reach the enum before their handler exists, because the schema is
    // migrated ahead of the feature. Silently succeeding would discard the work.
    await expect(runJob(context({ kind: "VIDEO_COMPOSE" }))).rejects.toMatchObject({
      safeErrorCode: "HANDLER_NOT_REGISTERED",
    })
  })

  it("refuses a duplicate registration for the same kind", () => {
    registerHandler("IMAGE_EVALUATE", async () => {})
    // Two handlers for one kind means one of them is dead code, which is worth
    // failing at startup rather than discovering from behaviour.
    expect(() => registerHandler("IMAGE_EVALUATE", async () => {})).toThrow(
      /HANDLER_ALREADY_REGISTERED/,
    )
  })

  it("propagates a handler failure so the runner can decide on a retry", async () => {
    registerHandler("IMAGE_EVALUATE", async () => {
      throw new Error("provider exploded")
    })
    await expect(runJob(context())).rejects.toThrow("provider exploded")
  })
})
