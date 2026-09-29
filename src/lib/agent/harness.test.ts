import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { BUDGET_EXHAUSTED_REPLY, runAgentLoop, toolSchema } from "./harness"
import {
  AgentError,
  defineTool,
  type AgentMessage,
  type AgentModel,
  type AgentTurn,
  type ToolContext,
} from "./types"

/**
 * The loop runs unattended inside a worker, so what is tested here is mostly what
 * happens when things go wrong: a model that invents a tool name, sends the wrong
 * arguments, never stops calling tools, or calls something it is not allowed to.
 * Each of those has to end with the user being told something true.
 */

function turn(partial: Partial<AgentTurn>): AgentTurn {
  return {
    content: "",
    toolCalls: [],
    usage: { promptTokens: null, completionTokens: null },
    ...partial,
  }
}

/** A model that replays a fixed script and records what it was shown. */
function scriptedModel(script: AgentTurn[]): AgentModel & { seen: AgentMessage[][] } {
  const seen: AgentMessage[][] = []
  let index = 0
  return {
    model: "fake",
    seen,
    async next({ messages }) {
      seen.push(messages.map((message) => ({ ...message })))
      const next = script[index]
      index += 1
      // Running off the end of the script means the loop asked for more steps
      // than the test expected, which is a failure worth surfacing loudly.
      return next ?? turn({ content: "unscripted" })
    },
  }
}

function context(signal = new AbortController().signal): ToolContext {
  return { heartbeat: vi.fn(async () => {}), report: vi.fn(async () => {}), signal }
}

const echoTool = (execute = vi.fn(async () => ({ ok: true as const, output: { echoed: true } }))) => ({
  tool: defineTool({
    name: "echo",
    description: "Echo a value back.",
    input: z.object({ value: z.string() }),
    execute,
  }),
  execute,
})

function harness(options: {
  script: AgentTurn[]
  tools?: ReturnType<typeof defineTool>[]
  preflight?: (tool: { name: string }, input: unknown) => Promise<{ allowed: boolean; reason?: string }>
  history?: AgentMessage[]
  maxSteps?: number
  signal?: AbortSignal
}) {
  const model = scriptedModel(options.script)
  const assistantTurns: AgentMessage[] = []
  const toolTurns: AgentMessage[] = []
  return {
    model,
    assistantTurns,
    toolTurns,
    run: () =>
      runAgentLoop({
        model,
        instructions: "Be useful.",
        history: options.history ?? [{ role: "user", content: "a matte black bottle" }],
        tools: options.tools ?? [],
        maxSteps: options.maxSteps,
        preflight: options.preflight as never,
        onAssistantTurn: async (message) => {
          assistantTurns.push(message)
        },
        onToolTurn: async (message) => {
          toolTurns.push(message)
        },
        context: context(options.signal),
      }),
  }
}

describe("runAgentLoop", () => {
  it("returns the model's text and stops", async () => {
    const run = harness({ script: [turn({ content: "What is it made of?" })] })
    const result = await run.run()

    expect(result).toMatchObject({ steps: 1, stop: "replied", reply: "What is it made of?", toolCalls: 0 })
    expect(run.assistantTurns).toHaveLength(1)
  })

  it("runs a requested tool and shows it the result on the next step", async () => {
    const { tool, execute } = echoTool()
    const run = harness({
      tools: [tool],
      script: [
        turn({ toolCalls: [{ id: "call_1", name: "echo", arguments: JSON.stringify({ value: "steel" }) }] }),
        turn({ content: "Got it, steel." }),
      ],
    })

    const result = await run.run()

    expect(execute).toHaveBeenCalledWith({ value: "steel" }, expect.anything())
    expect(result).toMatchObject({ steps: 2, stop: "replied", toolCalls: 1 })
    // The second model call must include the tool output, or the model asks again.
    const secondCall = run.model.seen[1]
    expect(secondCall.at(-1)).toMatchObject({ role: "tool", toolName: "echo" })
    expect(String(secondCall.at(-1)?.content)).toContain("echoed")
  })

  it("does not mutate the history it was given", async () => {
    const history: AgentMessage[] = [{ role: "user", content: "a bottle" }]
    const run = harness({ script: [turn({ content: "Sure." })], history })
    await run.run()
    expect(history).toHaveLength(1)
  })

  it("tells the model when it invented a tool name instead of crashing", async () => {
    const { tool } = echoTool()
    const run = harness({
      tools: [tool],
      script: [
        turn({ toolCalls: [{ id: "call_1", name: "teleport", arguments: "{}" }] }),
        turn({ content: "Let me try again." }),
      ],
    })

    const result = await run.run()

    expect(result.stop).toBe("replied")
    const toolTurn = run.toolTurns[0]
    expect(String(toolTurn.content)).toContain("UNKNOWN_TOOL")
    // Listing what does exist is what lets it recover on the next step.
    expect(String(toolTurn.content)).toContain("echo")
  })

  it("rejects arguments that do not match the tool's own validator", async () => {
    const { tool, execute } = echoTool()
    const run = harness({
      tools: [tool],
      script: [
        turn({ toolCalls: [{ id: "call_1", name: "echo", arguments: JSON.stringify({ value: 42 }) }] }),
        turn({ content: "Fixed." }),
      ],
    })

    await run.run()

    // "The model will send the right shape" is not an access control.
    expect(execute).not.toHaveBeenCalled()
    expect(String(run.toolTurns[0].content)).toContain("TOOL_ARGUMENTS_INVALID")
  })

  it("handles arguments that are not JSON at all", async () => {
    const { tool, execute } = echoTool()
    const run = harness({
      tools: [tool],
      script: [
        turn({ toolCalls: [{ id: "call_1", name: "echo", arguments: "{value: steel" }] }),
        turn({ content: "Fixed." }),
      ],
    })

    await run.run()

    expect(execute).not.toHaveBeenCalled()
    expect(String(run.toolTurns[0].content)).toContain("TOOL_ARGUMENTS_NOT_JSON")
  })

  it("treats an empty argument string as a call with no arguments", async () => {
    const execute = vi.fn(async () => ({ ok: true as const, output: { ready: true } }))
    const tool = defineTool({
      name: "status",
      description: "Read the current status.",
      input: z.object({}),
      execute,
    })
    const run = harness({
      tools: [tool],
      script: [turn({ toolCalls: [{ id: "call_1", name: "status", arguments: "" }] }), turn({ content: "Ready." })],
    })

    await run.run()
    expect(execute).toHaveBeenCalledOnce()
  })

  it("asks permission before a guarded tool and refuses without running it", async () => {
    const execute = vi.fn(async () => ({ ok: true as const, output: {} }))
    const tool = defineTool({
      name: "spend_credits",
      description: "Generate images.",
      input: z.object({}),
      guarded: true,
      execute,
    })
    const preflight = vi.fn(async () => ({ allowed: false, reason: "The brief is not ready yet." }))
    const run = harness({
      tools: [tool],
      preflight,
      script: [
        turn({ toolCalls: [{ id: "call_1", name: "spend_credits", arguments: "{}" }] }),
        turn({ content: "Tell me a bit more first." }),
      ],
    })

    await run.run()

    expect(preflight).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
    // The refusal reaches the model as a result, so it can explain rather than
    // silently retrying the same call.
    expect(String(run.toolTurns[0].content)).toContain("TOOL_NOT_PERMITTED")
    expect(String(run.toolTurns[0].content)).toContain("not ready")
  })

  it("runs a guarded tool once permission is granted", async () => {
    const execute = vi.fn(async () => ({ ok: true as const, output: { started: true } }))
    const tool = defineTool({
      name: "spend_credits",
      description: "Generate images.",
      input: z.object({}),
      guarded: true,
      execute,
    })
    const run = harness({
      tools: [tool],
      preflight: vi.fn(async () => ({ allowed: true })),
      script: [
        turn({ toolCalls: [{ id: "call_1", name: "spend_credits", arguments: "{}" }] }),
        turn({ content: "On it." }),
      ],
    })

    await run.run()
    expect(execute).toHaveBeenCalledOnce()
  })

  it("never consults the pre-flight check for an unguarded tool", async () => {
    const { tool } = echoTool()
    const preflight = vi.fn(async () => ({ allowed: true }))
    const run = harness({
      tools: [tool],
      preflight,
      script: [
        turn({ toolCalls: [{ id: "call_1", name: "echo", arguments: JSON.stringify({ value: "x" }) }] }),
        turn({ content: "Done." }),
      ],
    })

    await run.run()
    // A decision call per tool use would double the latency of the whole turn.
    expect(preflight).not.toHaveBeenCalled()
  })

  it("keeps going when a tool throws", async () => {
    const tool = defineTool({
      name: "flaky",
      description: "Fails.",
      input: z.object({}),
      execute: async () => {
        throw new Error("upstream exploded")
      },
    })
    const run = harness({
      tools: [tool],
      script: [
        turn({ toolCalls: [{ id: "call_1", name: "flaky", arguments: "{}" }] }),
        turn({ content: "That did not work, sorry." }),
      ],
    })

    const result = await run.run()

    expect(result.stop).toBe("replied")
    expect(String(run.toolTurns[0].content)).toContain("TOOL_FAILED")
  })

  it("passes a tool's own error code through rather than flattening it", async () => {
    const tool = defineTool({
      name: "flaky",
      description: "Fails.",
      input: z.object({}),
      execute: async () => {
        throw new AgentError("WEBSITE_UNAVAILABLE")
      },
    })
    const run = harness({
      tools: [tool],
      script: [turn({ toolCalls: [{ id: "call_1", name: "flaky", arguments: "{}" }] }), turn({ content: "Hm." })],
    })

    await run.run()
    expect(String(run.toolTurns[0].content)).toContain("WEBSITE_UNAVAILABLE")
  })

  it("always leaves the user with a reply when the step budget runs out", async () => {
    const { tool } = echoTool()
    const looping = turn({
      toolCalls: [{ id: "call_1", name: "echo", arguments: JSON.stringify({ value: "again" }) }],
    })
    const run = harness({ tools: [tool], maxSteps: 3, script: [looping, looping, looping] })

    const result = await run.run()

    expect(result).toMatchObject({ steps: 3, stop: "step_budget", reply: BUDGET_EXHAUSTED_REPLY })
    // A conversation left with a spinner and no reply is the failure this whole
    // rewrite exists to remove.
    expect(run.assistantTurns.at(-1)?.content).toBe(BUDGET_EXHAUSTED_REPLY)
  })

  it("stops immediately when shutdown has been requested", async () => {
    const controller = new AbortController()
    controller.abort()
    const run = harness({ script: [turn({ content: "should never be asked" })], signal: controller.signal })

    const result = await run.run()

    expect(result).toMatchObject({ steps: 0, stop: "aborted", reply: null })
    expect(run.model.seen).toHaveLength(0)
  })

  it("goes round again when the model returns neither text nor a tool call", async () => {
    const run = harness({ script: [turn({ content: "   " }), turn({ content: "Sorry, what is the product?" })] })
    const result = await run.run()
    expect(result).toMatchObject({ steps: 2, stop: "replied" })
  })

  it("accumulates token usage across every step", async () => {
    const { tool } = echoTool()
    const run = harness({
      tools: [tool],
      script: [
        turn({
          toolCalls: [{ id: "call_1", name: "echo", arguments: JSON.stringify({ value: "x" }) }],
          usage: { promptTokens: 100, completionTokens: 20 },
        }),
        turn({ content: "Done.", usage: { promptTokens: 150, completionTokens: 30 } }),
      ],
    })

    const result = await run.run()
    expect(result.promptTokens).toBe(250)
    expect(result.completionTokens).toBe(50)
  })

  it("leaves token counts null when the model reports none", async () => {
    const run = harness({ script: [turn({ content: "Done." })] })
    const result = await run.run()
    expect(result.promptTokens).toBeNull()
  })
})

describe("toolSchema", () => {
  it("derives the model-facing schema from the tool's validator", () => {
    const tool = defineTool({
      name: "read_website",
      description: "Read a brand site.",
      input: z.object({ url: z.string().url(), depth: z.number().optional() }),
      execute: async () => ({ ok: true as const, output: {} }),
    })

    const schema = toolSchema(tool)

    expect(schema.name).toBe("read_website")
    expect(schema.parameters).toMatchObject({
      type: "object",
      properties: { url: { type: "string" }, depth: { type: "number" } },
      required: ["url"],
    })
  })
})

describe("fresh state between model calls", () => {
  it("replaces the state turn with the current state before every call after the first", async () => {
    const { tool } = echoTool()
    const model = scriptedModel([
      turn({ toolCalls: [{ id: "call-1", name: "echo", arguments: '{"value":"x"}' }] }),
      turn({ content: "Done." }),
    ])
    await runAgentLoop({
      model,
      instructions: "test",
      history: [{ role: "user", content: "hi" }, { role: "system", content: "state: reading" }],
      tools: [tool],
      refreshState: async () => "state: read, 4 photos",
      onAssistantTurn: async () => {},
      onToolTurn: async () => {},
      context: context(),
    })
    expect(model.seen[0].find((message) => message.role === "system")?.content).toBe("state: reading")
    expect(model.seen[1].filter((message) => message.role === "system").map((message) => message.content)).toEqual(["state: read, 4 photos"])
  })
})
