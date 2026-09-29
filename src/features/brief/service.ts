import { z } from "zod"

import { getDefaultImageCount } from "@/features/admin/settings/service"
import { addProductPhoto } from "@/features/projects/product-photos"
import { MAX_PRODUCT_PHOTOS } from "@/features/projects/references"
import { deriveProjectName } from "@/features/projects/service"
import { getPrisma } from "@/lib/db/prisma"
import { runAgentLoop } from "@/lib/agent/harness"
import { OpenAIAgentModel } from "@/lib/agent/openai-model"
import type { AgentMessage, AgentModel, ToolContext } from "@/lib/agent/types"
import type { DecisionProvider } from "@/lib/decisions/types"
import { HttpError } from "@/lib/http/http-error"
import { scheduleAgentStep, scheduleWebsiteScrape } from "@/lib/jobs/schedule"
import { resolvePrompt } from "@/lib/prompts/templates"
import { resolveOpenAITextSettings } from "@/lib/providers/configuration"
import { resolveTextModels } from "@/lib/ai/text-models"

import { assessBrief, derivePhase } from "./classify"
import {
  appendMessage,
  ensureConversation,
  finishAgentRun,
  hasUnansweredUserMessage,
  readMessages,
  startAgentRun,
  toAgentHistory,
  updateConversationProgress,
} from "./conversation"
import { createBriefGuardrail } from "./guardrail"
import { SETTLING_LABEL } from "./labels"
import { BRIEF_INSTRUCTIONS, BRIEF_PROMPT_KEY } from "./prompt"
import { readBriefState, renderStateForAgent } from "./state"
import { createBriefTools } from "./tools"

/**
 * The conversational brief.
 *
 * Two entry points. A request appends the user's turn and queues work; the worker
 * runs the agent. Nothing model-shaped happens inside a request, which is what makes
 * a turn survive the user closing the tab — and what keeps a tool that starts a
 * crawl from holding an HTTP connection open for the length of it.
 */

/** How many turns a single conversation may hold, as a runaway guard. */
const MAX_CONVERSATION_MESSAGES = 400

export type PostMessageResult = {
  conversationId: string
  messageId: string
  jobId: string
}

export const briefOpeningSchema = z.object({
  /**
   * Two characters, not twelve.
   *
   * The form this replaces demanded a twelve-character brief up front, which is
   * exactly the wrong bar: someone who types "candles" gets told off by a
   * validator instead of being asked a question. Starting thin is the point.
   */
  message: z.string().trim().min(2).max(4_000),
  websiteUrl: z.string().trim().url().max(2048).optional(),
})

/**
 * Open a conversation, creating the project it belongs to.
 *
 * One call so the first turn is atomic from the user's side: they press send once
 * and land on a project with their message already in it, rather than saving a
 * brief and then starting a chat about it.
 */
/** Longest the first reply waits for the opening crawl before answering without it. */
const OPENING_CRAWL_WAIT_MS = 45_000

export async function startBriefConversation(input: {
  userId: string
  message: string
  websiteUrl?: string
  /** Product photos chosen on the create screen, saved before the first reply. */
  photos?: File[]
}): Promise<PostMessageResult & { projectId: string; photosRejected: number }> {
  const parsed = briefOpeningSchema.parse({ message: input.message, websiteUrl: input.websiteUrl })
  const targetImageCount = await getDefaultImageCount()

  const project = await getPrisma().project.create({
    data: {
      userId: input.userId,
      name: deriveProjectName(parsed.message),
      status: "DRAFT",
      targetImageCount,
      prompt: { create: { original: parsed.message } },
      websiteReference: parsed.websiteUrl ? { create: { url: new URL(parsed.websiteUrl).toString() } } : undefined,
    },
    select: { id: true },
  })

  // Photos first, so the agent's first reply already knows the product's look and
  // does not ask about colours or print the photos answer.
  let photosRejected = 0
  for (const photo of (input.photos ?? []).slice(0, MAX_PRODUCT_PHOTOS)) {
    await addProductPhoto(project.id, input.userId, photo).catch(() => {
      photosRejected += 1
    })
  }

  // With a link, the first reply waits for the page to be read (the crawl wakes the
  // agent when it finishes, read or not), so it starts from the real product and its
  // photos instead of asking what the page is about to answer. The delay is only a
  // fallback in case the crawl never reports back.
  let crawling = false
  if (parsed.websiteUrl) {
    crawling = await scheduleWebsiteScrape({ projectId: project.id, url: new URL(parsed.websiteUrl).toString() })
      .then(() => true)
      .catch((error: unknown) => {
        console.error("[brief] could not queue the opening crawl", {
          projectId: project.id,
          reason: error instanceof Error ? error.name : "unknown",
        })
        return false
      })
  }

  const posted = await postUserMessage({
    projectId: project.id,
    userId: input.userId,
    content: parsed.message,
    ...(crawling ? { replyDelayMs: OPENING_CRAWL_WAIT_MS } : {}),
  })

  return { ...posted, projectId: project.id, photosRejected }
}

/**
 * Record the user's turn and queue the agent.
 *
 * The first message also seeds `Prompt.original` when the project was created
 * without one, so a conversation that starts from nothing still produces the brief
 * every downstream step reads.
 */
export async function postUserMessage(input: {
  projectId: string
  userId: string
  content: string
  /** Hold the reply back (a fallback delay); something else will ask for it sooner. */
  replyDelayMs?: number
}): Promise<PostMessageResult> {
  const db = getPrisma()
  const project = await db.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { id: true, prompt: { select: { id: true, original: true } } },
  })
  if (!project) throw new HttpError(404, "Project not found")

  const conversation = await ensureConversation(project.id)

  const count = await db.message.count({ where: { conversationId: conversation.id } })
  if (count >= MAX_CONVERSATION_MESSAGES) {
    throw new HttpError(409, "This conversation has reached its limit. Start a new project to continue.")
  }

  const message = await appendMessage({
    conversationId: conversation.id,
    role: "USER",
    content: input.content,
  })

  // A project can be created with an empty prompt now that the brief is a
  // conversation; the first thing the user says becomes it.
  if (project.prompt && project.prompt.original.trim().length === 0) {
    await db.prompt.update({ where: { id: project.prompt.id }, data: { original: input.content } })
  } else if (!project.prompt) {
    await db.prompt.create({ data: { projectId: project.id, original: input.content } })
  }

  const job = await scheduleAgentStep({ conversationId: conversation.id, projectId: project.id, delayMs: input.replyDelayMs })

  return { conversationId: conversation.id, messageId: message.id, jobId: job.id }
}

export type BriefStepResult = {
  agentRunId: string
  steps: number
  toolCalls: number
  completeness: number
  ready: boolean | null
  stop: "replied" | "step_budget" | "aborted"
  /**
   * A message arrived while this step was running and has not been answered. The
   * handler turns this into a retry, which is the only way to answer it: agent steps
   * are deduped per conversation, so the message joined this job rather than creating
   * one of its own.
   */
  followUpNeeded: boolean
}

/**
 * Run one invocation of the agent for a conversation.
 *
 * Called by the AGENT_STEP handler. "One step" from the queue's point of view is one
 * pass of the loop's whole budget: it ends when the agent has said something to the
 * user, not when it has made one model call.
 */
export async function runBriefStep(
  conversationId: string,
  context: ToolContext,
  dependencies?: { model?: AgentModel; decisionProvider?: DecisionProvider },
): Promise<BriefStepResult> {
  const db = getPrisma()
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, projectId: true, project: { select: { userId: true } } },
  })
  if (!conversation) throw new HttpError(404, "Conversation not found")

  const state = await readBriefState(conversation.projectId)
  if (!state) throw new HttpError(404, "Project not found")

  const messages = await readMessages(conversationId)
  const prompt = await resolvePrompt(BRIEF_PROMPT_KEY, BRIEF_INSTRUCTIONS)
  const model = dependencies?.model ?? (await createBriefModel(prompt.model))

  const run = await startAgentRun({
    conversationId,
    model: model.model,
    promptTemplateId: prompt.templateId,
  })
  const startedAt = Date.now()

  // The state goes in as a trailing system turn rather than into the instructions,
  // so the recorded template id genuinely reproduces the instructions that were
  // used. State changes every step; the template does not.
  const history: AgentMessage[] = [
    ...toAgentHistory(messages),
    { role: "system", content: renderStateForAgent(state) },
  ]

  await context.report(10, messages.length <= 1 ? "Reading your brief" : "Reading your reply")

  try {
    const result = await runAgentLoop({
      model,
      instructions: prompt.body,
      history,
      tools: createBriefTools({
        projectId: conversation.projectId,
        userId: conversation.project.userId,
        narrate: async (line) => context.report(50, line),
      }),
      preflight: createBriefGuardrail({
        state,
        readState: () => readBriefState(conversation.projectId),
        messages,
        agentRunId: run.id,
        provider: dependencies?.decisionProvider,
      }),
      context,
      refreshState: async () => {
        const fresh = await readBriefState(conversation.projectId)
        return fresh ? renderStateForAgent(fresh) : null
      },
      onAssistantTurn: async (message) => {
        // A turn carrying only tool calls is still persisted: without it the
        // transcript has tool results answering nothing, and the model cannot be
        // re-fed its own history on a later invocation.
        await appendMessage({
          conversationId,
          role: "ASSISTANT",
          content: message.content,
          toolCalls: message.toolCalls,
        })
      },
      onToolTurn: async (message, toolResult) => {
        await appendMessage({
          conversationId,
          role: "TOOL",
          content: message.content,
          toolName: message.toolName ?? null,
          // The call id lives here so the turn can be replayed to the model; a
          // result without it is invisible to the model that asked for it.
          toolCalls: { callId: message.toolCallId },
          toolResult: { ok: toolResult.ok, userVisible: toolResult.userVisible ?? null },
        })
      },
    })

    // Assessed after the loop, so a turn that recorded new facts is measured with
    // them included. This is what moves the brief meter the user is watching.
    // The reply is already on screen by now; this label tells the UI not to block.
    await context.report(95, SETTLING_LABEL)
    const settled = await settleProgress({
      conversationId,
      projectId: conversation.projectId,
      decisionProvider: dependencies?.decisionProvider,
    })

    await finishAgentRun({
      agentRunId: run.id,
      status: "SUCCEEDED",
      steps: result.steps,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: Date.now() - startedAt,
    })

    return {
      agentRunId: run.id,
      steps: result.steps,
      toolCalls: result.toolCalls,
      completeness: settled.completeness,
      ready: settled.ready,
      stop: result.stop,
      followUpNeeded: await hasUnansweredUserMessage(conversationId),
    }
  } catch (error) {
    await finishAgentRun({
      agentRunId: run.id,
      status: "FAILED",
      steps: 0,
      promptTokens: null,
      completionTokens: null,
      latencyMs: Date.now() - startedAt,
      safeErrorCode: safeCodeOf(error),
    })
    throw error
  }
}

/**
 * Re-measure the brief and record where the conversation has got to.
 *
 * Separated out because the website crawl needs it too: a crawl that finds the
 * product changes how complete the brief is, and the meter should move when the
 * results land rather than waiting for the user to type again.
 */
export async function settleProgress(input: {
  conversationId: string
  projectId: string
  decisionProvider?: DecisionProvider
}): Promise<{ completeness: number; ready: boolean | null }> {
  const state = await readBriefState(input.projectId)
  if (!state) return { completeness: 0, ready: null }

  const messages = await readMessages(input.conversationId)
  const assessment = await assessBrief({
    state,
    messages,
    provider: input.decisionProvider,
  })

  const phase = derivePhase({
    state,
    assessment,
    productConfirmed: Boolean(state.product.facts?.confirmedProductUrl),
  })

  await updateConversationProgress({
    conversationId: input.conversationId,
    phase,
    completeness: assessment.completeness,
  })

  return { completeness: assessment.completeness, ready: assessment.ready }
}

async function createBriefModel(modelOverride: string | null): Promise<AgentModel> {
  const [settings, models] = await Promise.all([resolveOpenAITextSettings(), resolveTextModels()])
  return new OpenAIAgentModel({
    apiKey: settings.apiKey,
    // Admin → AI text, then OPENAI_AGENT_MODEL, then the text model.
    model: modelOverride ?? models.agent,
  })
}

function safeCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "safeErrorCode" in error) {
    const code = (error as { safeErrorCode?: unknown }).safeErrorCode
    if (typeof code === "string") return code
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return "AGENT_STEP_FAILED"
}
