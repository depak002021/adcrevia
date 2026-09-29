import { describe, expect, it } from "vitest"

import { toAgentHistory, type StoredMessage } from "./conversation"

/**
 * Rehydrating a transcript is where a stored conversation quietly stops working. A
 * tool result that loses the id of the call it answers is not an error — the model
 * simply cannot see its own tool output, asks for it again, and the turn burns its
 * whole step budget rediscovering what is already in the database.
 */

function message(partial: Partial<StoredMessage> & Pick<StoredMessage, "role" | "content">): StoredMessage {
  return {
    id: `m${Math.random()}`,
    toolName: null,
    toolCalls: null,
    toolResult: null,
    position: 1,
    createdAt: new Date(),
    ...partial,
  }
}

describe("toAgentHistory", () => {
  it("carries a tool result back with the call id it answers", () => {
    const history = toAgentHistory([
      message({ role: "USER", content: "read https://example.com" }),
      message({
        role: "ASSISTANT",
        content: "Reading it now.",
        toolCalls: [{ id: "call_1", name: "read_website", arguments: '{"url":"https://example.com"}' }],
      }),
      message({
        role: "TOOL",
        content: '{"ok":true}',
        toolName: "read_website",
        toolCalls: { callId: "call_1" },
      }),
    ])

    expect(history).toEqual([
      { role: "user", content: "read https://example.com" },
      {
        role: "assistant",
        content: "Reading it now.",
        toolCalls: [{ id: "call_1", name: "read_website", arguments: '{"url":"https://example.com"}' }],
      },
      { role: "tool", content: '{"ok":true}', toolName: "read_website", toolCallId: "call_1" },
    ])
  })

  it("omits the toolCalls key entirely on a plain assistant turn", () => {
    const [turn] = toAgentHistory([message({ role: "ASSISTANT", content: "What is it made of?" })])
    expect(turn).toEqual({ role: "assistant", content: "What is it made of?" })
  })

  it("ignores stored tool calls that are missing an id or a name", () => {
    // Written by an older deploy, or hand-edited. Half a call is worse than none:
    // the model would be shown a call it can never receive a result for.
    const [turn] = toAgentHistory([
      message({
        role: "ASSISTANT",
        content: "",
        toolCalls: [{ name: "read_website" }, { id: "call_2", name: "record_brief", arguments: "{}" }],
      }),
    ])
    expect(turn.toolCalls).toEqual([{ id: "call_2", name: "record_brief", arguments: "{}" }])
  })

  it("defaults absent arguments to an empty object rather than undefined", () => {
    const [turn] = toAgentHistory([
      message({ role: "ASSISTANT", content: "", toolCalls: [{ id: "call_1", name: "status" }] }),
    ])
    expect(turn.toolCalls?.[0].arguments).toBe("{}")
  })

  it("maps a system turn to a system turn rather than to the user", () => {
    const [turn] = toAgentHistory([message({ role: "SYSTEM", content: "Current project state" })])
    expect(turn.role).toBe("system")
  })

  it("leaves the call id undefined when a tool turn never recorded one", () => {
    const [turn] = toAgentHistory([message({ role: "TOOL", content: "{}", toolName: "echo" })])
    expect(turn.toolCallId).toBeUndefined()
  })
})
