import { Prisma } from "@/generated/prisma/client"
import type { ConversationPhase, MessageRole } from "@/generated/prisma/enums"
import { getPrisma } from "@/lib/db/prisma"
import type { AgentMessage, AgentToolCall } from "@/lib/agent/types"

/**
 * Conversation persistence.
 *
 * The transcript is the product's memory. It is also what the UI renders and what
 * the agent is re-fed on every step, so it has to be ordered unambiguously — hence
 * the explicit `position` column. `createdAt` is not enough: a tool result and the
 * assistant turn that consumed it routinely land inside the same millisecond, and
 * a transcript that shows them the wrong way round reads as nonsense.
 */

/** Turns handed back to the model. Older context is summarised by the state block. */
const HISTORY_LIMIT = 40

/** Position collisions are rare and self-resolving; a short retry is enough. */
const APPEND_ATTEMPTS = 5

export type StoredMessage = {
  id: string
  role: MessageRole
  content: string
  toolName: string | null
  toolCalls: unknown
  toolResult: unknown
  position: number
  createdAt: Date
}

/**
 * Find or create the conversation for a project.
 *
 * Every project has exactly one (`projectId` is unique), created on first use
 * rather than with the project, so the rows only exist for projects that actually
 * had a conversation.
 */
export async function ensureConversation(projectId: string) {
  const db = getPrisma()
  const existing = await db.conversation.findUnique({ where: { projectId } })
  if (existing) return existing

  try {
    return await db.conversation.create({ data: { projectId } })
  } catch (error) {
    // Two requests can reach this at once — the page load and the first message.
    // The unique index arbitrates, and the loser reads the winner's row.
    if (isUniqueViolation(error)) {
      const created = await db.conversation.findUnique({ where: { projectId } })
      if (created) return created
    }
    throw error
  }
}

export type AppendInput = {
  conversationId: string
  role: MessageRole
  content: string
  toolName?: string | null
  toolCalls?: unknown
  toolResult?: unknown
}

/**
 * Append a turn, assigning the next position.
 *
 * `max(position) + 1` inside a transaction, retried on a unique violation. A raw
 * `SELECT ... FOR UPDATE` would avoid the retry, but this path has to be correct on
 * a database this code has never connected to, and a retry loop is verifiable here
 * where a hand-written lock is not.
 */
export async function appendMessage(input: AppendInput): Promise<StoredMessage> {
  const db = getPrisma()

  for (let attempt = 1; attempt <= APPEND_ATTEMPTS; attempt += 1) {
    const last = await db.message.findFirst({
      where: { conversationId: input.conversationId },
      orderBy: { position: "desc" },
      select: { position: true },
    })

    try {
      return await db.message.create({
        data: {
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          toolName: input.toolName ?? null,
          toolCalls: toJsonOrUndefined(input.toolCalls),
          toolResult: toJsonOrUndefined(input.toolResult),
          position: (last?.position ?? 0) + 1,
        },
        select: messageSelect,
      })
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === APPEND_ATTEMPTS) throw error
    }
  }

  // Unreachable: the loop either returns or rethrows on its last attempt.
  throw new Error("MESSAGE_APPEND_FAILED")
}

/** The transcript, oldest first. */
export async function readMessages(conversationId: string, limit = HISTORY_LIMIT): Promise<StoredMessage[]> {
  const rows = await getPrisma().message.findMany({
    where: { conversationId },
    // Newest first with a take, then reversed: the tail is the part that matters,
    // and an `asc` take would hand back the beginning of a long conversation.
    orderBy: { position: "desc" },
    take: limit,
    select: messageSelect,
  })
  return rows.reverse()
}

/**
 * Convert stored turns into the form the model is given.
 *
 * Tool calls are rehydrated from the assistant turn that requested them, because
 * a tool result item is only meaningful next to the call it answers.
 */
export function toAgentHistory(messages: StoredMessage[]): AgentMessage[] {
  const history: AgentMessage[] = []

  for (const message of messages) {
    if (message.role === "TOOL") {
      history.push({
        role: "tool",
        content: message.content,
        toolName: message.toolName ?? undefined,
        toolCallId: readToolCallId(message.toolCalls),
      })
      continue
    }

    if (message.role === "ASSISTANT") {
      const toolCalls = readToolCalls(message.toolCalls)
      history.push({
        role: "assistant",
        content: message.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      })
      continue
    }

    history.push({ role: message.role === "SYSTEM" ? "system" : "user", content: message.content })
  }

  return history
}

export async function updateConversationProgress(input: {
  conversationId: string
  phase?: ConversationPhase
  completeness?: number
}) {
  await getPrisma().conversation.update({
    where: { id: input.conversationId },
    data: {
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.completeness === undefined
        ? {}
        : { completeness: Math.max(0, Math.min(100, Math.round(input.completeness))) }),
    },
  })
}

/**
 * Is somebody waiting for a reply?
 *
 * True when the newest turn is the user's. The case this exists for: agent steps are
 * deduped per conversation so two turns never interleave, which means a message sent
 * while a step is already RUNNING joins the running job — a job that read the
 * transcript before that message existed and will never see it. Checking at the end
 * of a step is what stops that message being silently dropped.
 */
export async function hasUnansweredUserMessage(conversationId: string): Promise<boolean> {
  const last = await getPrisma().message.findFirst({
    where: { conversationId },
    orderBy: { position: "desc" },
    select: { role: true },
  })
  return last?.role === "USER"
}

export function readConversationForProject(projectId: string) {
  return getPrisma().conversation.findUnique({
    where: { projectId },
    select: { id: true, projectId: true, phase: true, completeness: true, updatedAt: true },
  })
}

/** Start an accounting row for one invocation of the agent. */
export function startAgentRun(input: { conversationId: string; model: string; promptTemplateId: string | null }) {
  return getPrisma().agentRun.create({
    data: {
      conversationId: input.conversationId,
      status: "RUNNING",
      model: input.model,
      promptTemplateId: input.promptTemplateId,
      startedAt: new Date(),
    },
    select: { id: true },
  })
}

export async function finishAgentRun(input: {
  agentRunId: string
  status: "SUCCEEDED" | "FAILED"
  steps: number
  promptTokens: number | null
  completionTokens: number | null
  latencyMs: number
  safeErrorCode?: string | null
}) {
  await getPrisma().agentRun.update({
    where: { id: input.agentRunId },
    data: {
      status: input.status,
      steps: input.steps,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      latencyMs: input.latencyMs,
      safeErrorCode: input.safeErrorCode ?? null,
      completedAt: new Date(),
    },
  })
}

const messageSelect = {
  id: true,
  role: true,
  content: true,
  toolName: true,
  toolCalls: true,
  toolResult: true,
  position: true,
  createdAt: true,
} as const

function readToolCalls(value: unknown): AgentToolCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const call = entry as { id?: unknown; name?: unknown; arguments?: unknown }
    if (typeof call.id !== "string" || typeof call.name !== "string") return []
    return [{ id: call.id, name: call.name, arguments: typeof call.arguments === "string" ? call.arguments : "{}" }]
  })
}

/** A tool turn stores the id of the call it answers in the same column. */
function readToolCallId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const stored = value as { callId?: unknown }
  return typeof stored.callId === "string" ? stored.callId : undefined
}

function toJsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}
