import { describe, expect, it } from "vitest"

import { readTurn, toResponseItems } from "./openai-model"
import type { AgentMessage } from "./types"

/**
 * The item translation is worth pinning because getting it wrong fails silently.
 * A tool result sent without the right `call_id` does not error — the model simply
 * cannot see what its tool returned, asks for it again, and the conversation loops
 * until the step budget stops it.
 */

describe("toResponseItems", () => {
  it("sends a tool result as a function_call_output quoting the call it answers", () => {
    const history: AgentMessage[] = [
      { role: "user", content: "read https://example.com" },
      {
        role: "assistant",
        content: "Reading it now.",
        toolCalls: [{ id: "call_abc", name: "read_website", arguments: '{"url":"https://example.com"}' }],
      },
      { role: "tool", toolCallId: "call_abc", toolName: "read_website", content: '{"ok":true}' },
    ]

    expect(toResponseItems(history)).toEqual([
      { role: "user", content: "read https://example.com" },
      { role: "assistant", content: "Reading it now." },
      {
        type: "function_call",
        call_id: "call_abc",
        name: "read_website",
        arguments: '{"url":"https://example.com"}',
      },
      { type: "function_call_output", call_id: "call_abc", output: '{"ok":true}' },
    ])
  })

  it("omits an assistant turn that carried only tool calls", () => {
    const items = toResponseItems([
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "echo", arguments: "{}" }] },
    ])
    // An empty assistant message is rejected by the API, and it carries nothing.
    expect(items).toEqual([{ type: "function_call", call_id: "call_1", name: "echo", arguments: "{}" }])
  })

  it("passes user and system turns through as plain messages", () => {
    expect(
      toResponseItems([
        { role: "system", content: "Be brief." },
        { role: "user", content: "hello" },
      ]),
    ).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "hello" },
    ])
  })
})

describe("readTurn", () => {
  it("reads assistant text out of the output items", () => {
    const turn = readTurn({
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "What is it made of?" }] }],
      usage: { input_tokens: 420, output_tokens: 18 },
    })

    expect(turn.content).toBe("What is it made of?")
    expect(turn.toolCalls).toEqual([])
    expect(turn.usage).toEqual({ promptTokens: 420, completionTokens: 18 })
  })

  it("prefers call_id over the item id, because only one can be echoed back", () => {
    const turn = readTurn({
      output: [
        {
          type: "function_call",
          id: "fc_item_id",
          call_id: "call_the_one_that_matters",
          name: "read_website",
          arguments: '{"url":"https://example.com"}',
        },
      ],
    })

    expect(turn.toolCalls).toEqual([
      {
        id: "call_the_one_that_matters",
        name: "read_website",
        arguments: '{"url":"https://example.com"}',
      },
    ])
  })

  it("reads text and tool calls from the same turn", () => {
    const turn = readTurn({
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Let me read that." }] },
        { type: "function_call", call_id: "call_1", name: "read_website", arguments: "{}" },
      ],
    })

    // The narration is what the user sees while the tool runs, so it must survive.
    expect(turn.content).toBe("Let me read that.")
    expect(turn.toolCalls).toHaveLength(1)
  })

  it("ignores item types it does not handle", () => {
    const turn = readTurn({
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hi." }] },
      ],
    })
    expect(turn.content).toBe("Hi.")
  })

  it("survives a payload with no output at all", () => {
    expect(readTurn({})).toEqual({
      content: "",
      toolCalls: [],
      usage: { promptTokens: null, completionTokens: null },
    })
  })
})
