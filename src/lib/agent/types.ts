import type { z } from "zod"

/**
 * Contracts for the agent loop.
 *
 * The brief used to be a form: three inputs, a submit button, and four stateless
 * model calls behind it. A form cannot ask a follow-up question, cannot go and
 * read the site you mentioned, and cannot tell you it still does not know what
 * your product is. This is the layer that can.
 *
 * Nothing here knows anything about Adcrevia. Tools, instructions and the
 * pre-flight check are all injected, so the loop can be tested against a fake
 * model and a fake tool without a database or a provider.
 */

export type AgentRole = "system" | "user" | "assistant" | "tool"

/** One entry of conversation history, in the form the model is given it. */
export type AgentMessage = {
  role: AgentRole
  content: string
  /** Set on an assistant turn that requested tools. */
  toolCalls?: AgentToolCall[]
  /** Set when `role` is "tool". */
  toolName?: string
  toolCallId?: string
}

export type AgentToolCall = {
  id: string
  name: string
  /** Raw JSON text from the model. Parsed and validated before use. */
  arguments: string
}

/**
 * What a tool hands back.
 *
 * `output` goes to the model. `userVisible` is an optional line for the
 * transcript, because "read the site" should read as something happening rather
 * than as a JSON blob. A failure is a result, not an exception: the model has to
 * see that the tool failed so it can say so or try something else, which is the
 * whole reason the loop continues after one.
 */
export type ToolResult =
  | { ok: true; output: unknown; userVisible?: string }
  | { ok: false; safeErrorCode: string; output?: unknown; userVisible?: string }

export type AgentTool<Input = unknown> = {
  name: string
  /** Shown to the model. This is the only thing telling it when to reach for this. */
  description: string
  /** Validates the model's arguments before anything runs. */
  input: z.ZodType<Input>
  /**
   * True when running this costs money, mutates something durable, or touches a
   * remote host. Those are the calls the pre-flight check gates.
   */
  guarded?: boolean
  execute(input: Input, context: ToolContext): Promise<ToolResult>
}

/**
 * A tool of unknown argument shape.
 *
 * The loop holds a heterogeneous list, and `z.ZodType<Input>` puts `Input` in both
 * an input and an output position, so no single concrete parameter makes the list
 * assignable. `defineTool` is how a tool author still gets full inference: the
 * erasure happens once, at registration, rather than at every call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgentTool = AgentTool<any>

/** Register a tool with its argument type inferred from its validator. */
export function defineTool<Schema extends z.ZodType>(tool: {
  name: string
  description: string
  input: Schema
  guarded?: boolean
  execute(input: z.output<Schema>, context: ToolContext): Promise<ToolResult>
}): AnyAgentTool {
  return tool as AnyAgentTool
}

export type ToolContext = {
  /** Extend the job lease from a tool that can run long. */
  heartbeat(): Promise<void>
  /** Publish progress while a tool works. */
  report(progress: number, label?: string): Promise<void>
  signal: AbortSignal
}

export type AgentUsage = {
  promptTokens: number | null
  completionTokens: number | null
}

export type AgentTurn = {
  /** Assistant text. Empty on a turn that only requested tools. */
  content: string
  toolCalls: AgentToolCall[]
  usage: AgentUsage
}

/** A tool as the model is shown it. */
export type AgentToolSchema = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface AgentModel {
  readonly model: string
  next(input: {
    instructions: string
    messages: AgentMessage[]
    tools: AgentToolSchema[]
    signal?: AbortSignal
  }): Promise<AgentTurn>
}

/** Outcome of a pre-flight check on a guarded tool. */
export type PreflightDecision = {
  allowed: boolean
  /**
   * Given to the model when a call is refused, so it can explain itself or ask
   * the user rather than silently trying the same thing again.
   */
  reason?: string
}

export type AgentLoopResult = {
  /** Model turns taken. One step is one model call plus any tools it requested. */
  steps: number
  /** The assistant text the loop finished on, if it produced any. */
  reply: string | null
  /** Why the loop stopped. */
  stop: "replied" | "step_budget" | "aborted"
  promptTokens: number | null
  completionTokens: number | null
  toolCalls: number
}

export class AgentError extends Error {
  constructor(
    readonly safeErrorCode: string,
    message?: string,
  ) {
    super(message ?? safeErrorCode)
    this.name = "AgentError"
  }
}
