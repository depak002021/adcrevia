import OpenAI from "openai"
import type { ResponseInputItem } from "openai/resources/responses/responses"

import { reasoningFor } from "@/lib/ai/reasoning"

import { AgentError, type AgentMessage, type AgentModel, type AgentToolSchema, type AgentTurn } from "./types"

/**
 * OpenAI Responses adapter for the agent loop.
 *
 * Conversation state is re-sent on every step rather than carried with
 * `previous_response_id`. That is more tokens, and it is the right trade here: the
 * transcript already has to be durable in Postgres for the UI to render it, and a
 * job that resumes after a worker restart cannot rely on a response id the
 * provider may have expired. One source of truth for the history, which is the
 * database.
 *
 * Tools are declared non-strict. The strict subset rejects the JSON Schema that
 * ordinary Zod objects produce (patterns, unions, optional fields), and arguments
 * are validated against the Zod schema before anything executes either way — so
 * strict mode would trade real failures for no extra safety.
 */

const DEFAULT_MODEL = "gpt-5-mini"

/** A brief turn involving a crawl can legitimately take a while to compose. */
const DEFAULT_TIMEOUT_MS = 90_000

export type OpenAIAgentModelOptions = {
  apiKey: string
  model?: string
  timeoutMs?: number
  /** Injected in tests. Only `responses.create` is used. */
  client?: Pick<OpenAI["responses"], "create">
}

export class OpenAIAgentModel implements AgentModel {
  readonly model: string
  private readonly responses: Pick<OpenAI["responses"], "create">
  private readonly timeoutMs: number

  constructor(options: OpenAIAgentModelOptions) {
    if (!options.client && !options.apiKey) throw new AgentError("AGENT_MODEL_NOT_CONFIGURED")
    this.model = options.model ?? DEFAULT_MODEL
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.responses = options.client ?? new OpenAI({ apiKey: options.apiKey }).responses
  }

  async next(input: {
    instructions: string
    messages: AgentMessage[]
    tools: AgentToolSchema[]
    signal?: AbortSignal
  }): Promise<AgentTurn> {
    const response = await this.responses
      .create(
        {
          model: this.model,
          ...reasoningFor(this.model, "low"),
          instructions: input.instructions,
          input: toResponseItems(input.messages),
          tools: input.tools.map((tool) => ({
            type: "function" as const,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: false,
          })),
          // The transcript lives in our database, so there is nothing to gain from
          // the provider retaining a copy of it.
          store: false,
        },
        { signal: input.signal, timeout: this.timeoutMs },
      )
      .catch((error: unknown) => {
        throw new AgentError(
          "AGENT_MODEL_UNAVAILABLE",
          `openai ${error instanceof Error ? error.name : "error"}`,
        )
      })

    return readTurn(response)
  }
}

/**
 * Convert the internal history into Responses input items.
 *
 * A tool result is not a message with a role; it is a `function_call_output` item
 * that has to quote the `call_id` of the call it answers. Getting that wrong does
 * not error — the model simply cannot see what its tool returned, and asks again.
 */
export function toResponseItems(messages: AgentMessage[]): ResponseInputItem[] {
  const items: ResponseInputItem[] = []

  for (const message of messages) {
    if (message.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: message.toolCallId ?? "",
        output: message.content,
      })
      continue
    }

    if (message.role === "assistant") {
      if (message.content.trim().length > 0) {
        items.push({ role: "assistant", content: message.content })
      }
      for (const call of message.toolCalls ?? []) {
        items.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        })
      }
      continue
    }

    items.push({ role: message.role, content: message.content })
  }

  return items
}

/** Pull the assistant text and any tool calls out of a Responses payload. */
export function readTurn(response: unknown): AgentTurn {
  const payload = response as {
    output?: Array<Record<string, unknown>>
    usage?: { input_tokens?: number; output_tokens?: number } | null
  }

  const texts: string[] = []
  const toolCalls: AgentTurn["toolCalls"] = []

  for (const item of payload.output ?? []) {
    if (item.type === "function_call") {
      toolCalls.push({
        // `call_id` is what a result has to quote back; `id` identifies the item
        // itself and is not interchangeable with it.
        id: String(item.call_id ?? item.id ?? ""),
        name: String(item.name ?? ""),
        arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
      })
      continue
    }

    if (item.type === "message") {
      for (const part of (item.content as Array<Record<string, unknown>>) ?? []) {
        if (part.type === "output_text" && typeof part.text === "string") texts.push(part.text)
      }
    }
  }

  return {
    content: texts.join("\n").trim(),
    toolCalls,
    usage: {
      promptTokens: payload.usage?.input_tokens ?? null,
      completionTokens: payload.usage?.output_tokens ?? null,
    },
  }
}
