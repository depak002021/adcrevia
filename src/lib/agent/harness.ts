import { z } from "zod"

import {
  AgentError,
  type AgentLoopResult,
  type AgentMessage,
  type AgentModel,
  type AgentToolSchema,
  type AnyAgentTool,
  type PreflightDecision,
  type ToolContext,
  type ToolResult,
} from "./types"

/**
 * The agent loop.
 *
 * A model call, then any tools it asked for, then round again — until it produces
 * text for the user or runs out of steps. Three things make it safe to run
 * unattended inside a worker:
 *
 *  - A hard step budget. Without one, a model that keeps calling the same tool
 *    because the tool keeps returning the same unhelpful answer will do so until
 *    the lease expires, then do it again on the retry.
 *  - Arguments are validated before execution. A tool is real code touching real
 *    rows; "the model will send the right shape" is not an access control.
 *  - Guarded tools go through a pre-flight check. Anything that spends credits or
 *    reaches a remote host asks permission first, and a refusal comes back to the
 *    model as a tool result so it can explain itself instead of retrying blindly.
 *
 * The loop always ends with something said to the user. Exhausting the budget in
 * silence would leave a conversation with a spinner and no reply, which is the
 * failure this whole rewrite exists to remove.
 *
 * Nothing here knows anything about Adcrevia. Tools, instructions and the
 * pre-flight check are injected, so the loop is tested against a fake model and a
 * fake tool with no database and no provider.
 */

/**
 * Model calls per invocation.
 *
 * Six is enough for read-the-site, look-at-what-came-back, ask-one-question and
 * still have room to recover from a tool failure. It is also small enough that a
 * runaway loop is bounded well inside a two-minute lease.
 */
const DEFAULT_MAX_STEPS = 6

/** What the user is told when the loop ran out of steps without replying. */
export const BUDGET_EXHAUSTED_REPLY =
  "I got a bit tangled working that out. Tell me a little more about the product and I will pick it straight back up."

export type AgentLoopInput = {
  model: AgentModel
  instructions: string
  /** Conversation so far, oldest first. Not mutated. */
  history: AgentMessage[]
  tools: AnyAgentTool[]
  maxSteps?: number
  /** Consulted before any tool marked `guarded`. */
  preflight?(tool: AnyAgentTool, input: unknown): Promise<PreflightDecision>
  /**
   * The current project state as a system turn, re-read before every model call
   * after the first. Work finishes while a turn runs (a crawl lands, photos are
   * saved), and a model reading the state from the start of the turn tells the user
   * "I'm reading the page" after it has been read.
   */
  refreshState?(): Promise<string | null>
  /** Persist an assistant turn. Called for text turns and for tool-call turns. */
  onAssistantTurn(message: AgentMessage): Promise<void>
  /** Persist a tool result. The raw result carries the line worth showing a user. */
  onToolTurn(message: AgentMessage, result: ToolResult): Promise<void>
  context: ToolContext
}

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS
  const tools = new Map(input.tools.map((tool) => [tool.name, tool]))
  const schemas = input.tools.map(toolSchema)

  // Local working copy: the loop appends to it so the model sees its own tool
  // results on the next step, while the caller's history stays untouched.
  const messages: AgentMessage[] = [...input.history]

  let promptTokens: number | null = null
  let completionTokens: number | null = null
  let toolCalls = 0

  for (let step = 1; step <= maxSteps; step += 1) {
    if (input.context.signal.aborted) {
      return { steps: step - 1, reply: null, stop: "aborted", promptTokens, completionTokens, toolCalls }
    }

    if (step > 1 && input.refreshState) {
      const fresh = await input.refreshState().catch(() => null)
      if (fresh) {
        const index = messages.findLastIndex((message) => message.role === "system")
        if (index >= 0) messages[index] = { role: "system", content: fresh }
      }
    }

    const turn = await input.model.next({
      instructions: input.instructions,
      messages,
      tools: schemas,
      signal: input.context.signal,
    })

    promptTokens = addTokens(promptTokens, turn.usage.promptTokens)
    completionTokens = addTokens(completionTokens, turn.usage.completionTokens)

    const assistantMessage: AgentMessage = {
      role: "assistant",
      content: turn.content,
      ...(turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {}),
    }
    messages.push(assistantMessage)
    await input.onAssistantTurn(assistantMessage)

    if (turn.toolCalls.length === 0) {
      if (turn.content.trim().length > 0) {
        return { steps: step, reply: turn.content, stop: "replied", promptTokens, completionTokens, toolCalls }
      }
      // Neither text nor tools is a dead end rather than a reply. Going round
      // again is cheap; the budget below guarantees the user still gets an answer.
      continue
    }

    for (const call of turn.toolCalls) {
      toolCalls += 1
      const { message, result } = await executeCall({ call, tools, input })
      messages.push(message)
      await input.onToolTurn(message, result)
    }
  }

  // Out of steps. Say something true rather than leaving the user watching a
  // spinner that will never resolve.
  const reply: AgentMessage = { role: "assistant", content: BUDGET_EXHAUSTED_REPLY }
  await input.onAssistantTurn(reply)
  return {
    steps: maxSteps,
    reply: BUDGET_EXHAUSTED_REPLY,
    stop: "step_budget",
    promptTokens,
    completionTokens,
    toolCalls,
  }
}

async function executeCall(context: {
  call: { id: string; name: string; arguments: string }
  tools: Map<string, AnyAgentTool>
  input: AgentLoopInput
}): Promise<{ message: AgentMessage; result: ToolResult }> {
  const { call, tools, input } = context
  const tool = tools.get(call.name)

  // An unknown tool name is the model's mistake, not a crash. Telling it so lets
  // it choose a real tool on the next step.
  if (!tool) {
    return toolTurn(call, {
      ok: false,
      safeErrorCode: "UNKNOWN_TOOL",
      output: { availableTools: [...tools.keys()] },
    })
  }

  const parsedJson = parseArguments(call.arguments)
  if (!parsedJson.ok) return toolTurn(call, { ok: false, safeErrorCode: "TOOL_ARGUMENTS_NOT_JSON" })

  const parsed = tool.input.safeParse(parsedJson.value)
  if (!parsed.success) {
    // The validation detail goes back to the model deliberately: it is the only
    // way it can correct the shape on the next step.
    return toolTurn(call, {
      ok: false,
      safeErrorCode: "TOOL_ARGUMENTS_INVALID",
      output: { issues: z.prettifyError(parsed.error).slice(0, 600) },
    })
  }

  if (tool.guarded && input.preflight) {
    const decision = await input.preflight(tool, parsed.data)
    if (!decision.allowed) {
      return toolTurn(call, {
        ok: false,
        safeErrorCode: "TOOL_NOT_PERMITTED",
        // The reason is guidance for the model ("ask the user…"), not a line for the
        // user; the model's own reply explains the situation in its words.
        output: { reason: decision.reason ?? "This action was not permitted for this request." },
      })
    }
  }

  try {
    return toolTurn(call, await tool.execute(parsed.data, input.context))
  } catch (error) {
    // A tool throwing must not end the conversation. The model sees the failure
    // and can tell the user about it, which is strictly better than the whole job
    // failing and the user seeing nothing at all.
    if (error instanceof AgentError) return toolTurn(call, { ok: false, safeErrorCode: error.safeErrorCode })
    return toolTurn(call, { ok: false, safeErrorCode: "TOOL_FAILED" })
  }
}

function toolTurn(
  call: { id: string; name: string },
  result: ToolResult,
): { message: AgentMessage; result: ToolResult } {
  const payload = result.ok
    ? { ok: true, result: result.output ?? null }
    : { ok: false, error: result.safeErrorCode, detail: result.output ?? null }
  return {
    message: { role: "tool", toolCallId: call.id, toolName: call.name, content: JSON.stringify(payload) },
    result,
  }
}

function parseArguments(raw: string): { ok: true; value: unknown } | { ok: false } {
  // An empty argument string is what a zero-parameter tool call looks like.
  if (raw.trim() === "") return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false }
  }
}

/**
 * Derive the schema the model is shown from the tool's own validator.
 *
 * One definition, so the shape the model is told about and the shape that is
 * enforced cannot drift apart. That drift is the usual cause of a tool the model
 * calls confidently and correctly, and that rejects every single call.
 */
export function toolSchema(tool: AnyAgentTool): AgentToolSchema {
  return {
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.input, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>,
  }
}

function addTokens(total: number | null, value: number | null): number | null {
  if (value === null) return total
  return (total ?? 0) + value
}
