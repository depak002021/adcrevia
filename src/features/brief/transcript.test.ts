import { describe, expect, it } from "vitest"

import type { StoredMessage } from "./conversation"
import { readKnowledge, toEntries } from "./transcript"

/**
 * The transcript is what the user reads, so what is pinned here is what must never
 * reach them: raw tool JSON, an empty assistant turn that exists only to carry tool
 * calls, and the state block the agent is fed on every step.
 */

function message(partial: Partial<StoredMessage> & Pick<StoredMessage, "role" | "content">): StoredMessage {
  return {
    id: `m-${partial.position ?? 1}`,
    toolName: null,
    toolCalls: null,
    toolResult: null,
    position: 1,
    createdAt: new Date("2026-09-23T10:00:00.000Z"),
    ...partial,
  }
}

describe("toEntries", () => {
  it("shows a tool turn as the one line the tool wrote, never its payload", () => {
    const entries = toEntries([
      message({
        role: "TOOL",
        content: '{"ok":true,"result":{"queued":true,"jobId":"job_1","note":"internal guidance"}}',
        toolName: "read_website",
        toolResult: { ok: true, userVisible: "Reading example.com" },
      }),
    ])

    expect(entries).toEqual([
      { id: "m-1", role: "activity", content: "Reading example.com", at: "2026-09-23T10:00:00.000Z", tool: "read_website" },
    ])
  })

  it("drops a tool turn that had nothing worth saying", () => {
    // `record_brief` writing a fact is not news. An entry per tool call would turn
    // the transcript into a log.
    expect(
      toEntries([
        message({ role: "TOOL", content: '{"ok":true}', toolName: "record_brief", toolResult: { ok: true } }),
      ]),
    ).toEqual([])
  })

  it("drops an assistant turn that only carried tool calls", () => {
    // It stays in the database, because the model needs it to make sense of its own
    // history. It is just not speech.
    expect(
      toEntries([
        message({ role: "ASSISTANT", content: "", toolCalls: [{ id: "call_1", name: "read_website" }] }),
      ]),
    ).toEqual([])
  })

  it("never shows the state block the agent is fed on every step", () => {
    expect(toEntries([message({ role: "SYSTEM", content: "Current project state: {...}" })])).toEqual([])
  })

  it("keeps user and assistant speech in transcript order", () => {
    const entries = toEntries([
      message({ role: "USER", content: "a matte black bottle", position: 1 }),
      message({ role: "ASSISTANT", content: "What is it made of?", position: 2 }),
    ])
    expect(entries.map((entry) => entry.role)).toEqual(["user", "assistant"])
  })

  it("serialises timestamps, so a streamed frame and a rendered one compare equal", () => {
    const [entry] = toEntries([message({ role: "USER", content: "hello" })])
    // The snapshot is diffed as a JSON string to decide whether to push a frame; a
    // Date here would serialise differently depending on the path it took.
    expect(typeof entry.at).toBe("string")
  })
})

describe("readKnowledge", () => {
  const base = {
    targetImageCount: 4,
    prompt: null,
    brandPalette: null,
    websiteReference: null,
    directions: [],
  }

  it("reads the recorded facts back out", () => {
    const knows = readKnowledge({
      ...base,
      prompt: {
        productJson: {
          productName: "Trail 750",
          physicalDetail: "Matte black powder-coated steel",
          audience: "Trail runners",
        },
      },
    })

    expect(knows.productName).toBe("Trail 750")
    expect(knows.physicalDetail).toBe("Matte black powder-coated steel")
    expect(knows.audience).toBe("Trail runners")
    expect(knows.mood).toBeNull()
  })

  it("treats a blank string as nothing recorded", () => {
    const knows = readKnowledge({ ...base, prompt: { productJson: { productName: "   " } } })
    expect(knows.productName).toBeNull()
  })

  it("prefers a chosen palette over one inferred from the site", () => {
    const knows = readKnowledge({
      ...base,
      prompt: { productJson: { palette: ["#111111"] } },
      brandPalette: { colors: ["#D8F651", "#07080A"] },
    })
    // A palette row exists only once somebody or something decided on one.
    expect(knows.palette).toEqual(["#D8F651", "#07080A"])
  })

  it("falls back to the site's palette when nothing has been chosen", () => {
    const knows = readKnowledge({ ...base, prompt: { productJson: { palette: ["#111111"] } } })
    expect(knows.palette).toEqual(["#111111"])
  })

  it("reports a site that could not be read as not analysed", () => {
    const knows = readKnowledge({
      ...base,
      websiteReference: {
        url: "https://example.com",
        title: null,
        analysis: null,
        safeErrorCode: "WEBSITE_UNAVAILABLE",
        analyzedAt: new Date(),
      },
    })
    // Analysed-but-failed is not analysed: nothing from it is being used, and the
    // panel says so rather than showing an empty brand section.
    expect(knows.website?.analyzed).toBe(false)
    expect(knows.website?.safeErrorCode).toBe("WEBSITE_UNAVAILABLE")
  })

  it("lists the candidate products a crawl found", () => {
    const knows = readKnowledge({
      ...base,
      websiteReference: {
        url: "https://example.com",
        title: "Example",
        analysis: { products: [{ name: "Trail 750" }, { name: "Summit 1L" }, { notAProduct: true }] },
        safeErrorCode: null,
        analyzedAt: new Date(),
      },
    })
    expect(knows.candidates).toEqual(["Trail 750", "Summit 1L"])
  })

  it("survives a productJson that is not an object", () => {
    // Written by an older deploy, or hand-edited in the database.
    const knows = readKnowledge({ ...base, prompt: { productJson: "unexpected" } })
    expect(knows.productName).toBeNull()
    expect(knows.palette).toEqual([])
  })
})
