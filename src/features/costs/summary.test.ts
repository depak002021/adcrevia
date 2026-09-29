import { describe, expect, it } from "vitest"

import { summarizeSpend } from "./summary"

describe("summarizeSpend", () => {
  it("adds up finished renders by kind and provider, ignoring started rows", () => {
    const summary = summarizeSpend([
      { kind: "image", status: "SUCCEEDED", provider: "google", projectId: "p", details: { costUsd: 0.101 } },
      { kind: "image", status: "SUCCEEDED", provider: "bfl", projectId: "p", details: { costUsd: 0.12 } },
      { kind: "video", status: "STARTED", provider: "kling", projectId: "p", details: { estimatedUsd: 0.34 } },
      { kind: "video", status: "SUCCEEDED", provider: "kling", projectId: "p", details: { costUsd: 0.336 } },
      { kind: "video", status: "FAILED", provider: "google", projectId: "p", details: { costUsd: 0 } },
    ])
    expect(summary).toMatchObject({ totalUsd: 0.557, images: { count: 2, usd: 0.221 }, videos: { count: 1, usd: 0.336 }, unpriced: 0 })
    expect(summary.byProvider[0]).toEqual({ provider: "kling", usd: 0.336, count: 1 })
  })

  it("counts finished renders without a recorded cost as unpriced, never as free", () => {
    const summary = summarizeSpend([{ kind: "image", status: "SUCCEEDED", provider: "google", projectId: "p", details: { position: 1 } }])
    expect(summary).toMatchObject({ totalUsd: 0, unpriced: 1, images: { count: 0 } })
  })
})
