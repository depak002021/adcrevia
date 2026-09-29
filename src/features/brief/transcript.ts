import type { ConversationPhase } from "@/generated/prisma/enums"
import { getPrisma } from "@/lib/db/prisma"

import { readMessages, type StoredMessage } from "./conversation"

/**
 * The transcript, shaped for the screen.
 *
 * Kept separate from the agent service on purpose: this is read on every render and
 * on every frame of the event stream, and importing the service would drag the
 * agent, the model SDK and the decision layer into a request that only needs two
 * queries.
 */

/** How many entries the UI is given. Older turns are still in the database. */
const VISIBLE_ENTRIES = 30

export type TranscriptEntry = {
  id: string
  /** `activity` is a tool's own one-line summary, rendered differently from speech. */
  role: "user" | "assistant" | "activity"
  content: string
  /** For `activity`: which tool produced it, so the UI can show its result inline. */
  tool?: string
  at: string
}

/**
 * What the product has actually understood, as opposed to what was said.
 *
 * Shown to the user because a conversation with an agent is otherwise opaque: the
 * only evidence that "matte black, for trail runners" landed anywhere is that the
 * images come back right, which is far too late to find out it did not. This is the
 * receipt.
 */
export type BriefKnowledge = {
  productName: string | null
  productSummary: string | null
  physicalDetail: string | null
  audience: string | null
  mood: string | null
  usageContext: string | null
  palette: string[]
  website: {
    url: string
    title: string | null
    analyzed: boolean
    safeErrorCode: string | null
    /** The product the link is about, when it is a product page. */
    productName: string | null
    /** Photos of that product saved for generation. */
    photos: number
  } | null
  /** Product names the crawl found, when there is more than one candidate. */
  candidates: string[]
  confirmedProductUrl: string | null
  directions: Array<{ position: number; title: string; mood: string }>
  concepts: number
}

export type BriefTranscript = {
  conversationId: string
  phase: ConversationPhase
  completeness: number
  entries: TranscriptEntry[]
  knows: BriefKnowledge
}

export async function readBriefTranscript(projectId: string): Promise<BriefTranscript | null> {
  const conversation = await getPrisma().conversation.findUnique({
    where: { projectId },
    select: {
      id: true,
      phase: true,
      completeness: true,
      project: {
        select: {
          targetImageCount: true,
          prompt: { select: { productJson: true } },
          brandPalette: { select: { colors: true } },
          websiteReference: {
            select: { url: true, title: true, analysis: true, safeErrorCode: true, analyzedAt: true },
          },
          directions: { orderBy: { position: "asc" }, select: { position: true, title: true, mood: true } },
        },
      },
    },
  })
  if (!conversation) return null

  const messages = await readMessages(conversation.id)

  return {
    conversationId: conversation.id,
    phase: conversation.phase,
    completeness: conversation.completeness,
    entries: toEntries(messages).slice(-VISIBLE_ENTRIES),
    knows: readKnowledge(conversation.project),
  }
}

type ProjectKnowledgeRow = {
  targetImageCount: number
  prompt: { productJson: unknown } | null
  brandPalette: { colors: unknown } | null
  websiteReference: {
    url: string
    title: string | null
    analysis: unknown
    safeErrorCode: string | null
    analyzedAt: Date | null
  } | null
  directions: Array<{ position: number; title: string; mood: string }>
}

export function readKnowledge(project: ProjectKnowledgeRow): BriefKnowledge {
  const facts = asRecord(project.prompt?.productJson)
  const analysis = asRecord(project.websiteReference?.analysis)

  return {
    productName: readString(facts?.productName) ?? readString(facts?.brandName),
    productSummary: readString(facts?.productSummary),
    physicalDetail: readString(facts?.physicalDetail),
    audience: readString(facts?.audience),
    mood: readString(facts?.mood),
    usageContext: readString(facts?.usageContext),
    // The palette row wins over the crawl's, because a row exists only once
    // somebody or something decided on one.
    palette: readStrings(project.brandPalette?.colors).length
      ? readStrings(project.brandPalette?.colors)
      : readStrings(facts?.palette),
    website: project.websiteReference
      ? {
          url: project.websiteReference.url,
          title: project.websiteReference.title,
          analyzed: project.websiteReference.analyzedAt !== null && project.websiteReference.safeErrorCode === null,
          safeErrorCode: project.websiteReference.safeErrorCode,
          productName:
            analysis?.hasPrimaryProduct === true && Array.isArray(analysis.products)
              ? readString(asRecord(analysis.products[0])?.name)
              : null,
          photos: readStrings(facts?.referenceImages).length,
        }
      : null,
    candidates: readProductNames(analysis ?? facts).slice(0, 6),
    confirmedProductUrl: readString(facts?.confirmedProductUrl),
    directions: project.directions,
    concepts: project.targetImageCount,
  }
}

/**
 * Turn stored turns into something worth reading.
 *
 * Tool turns become the one-line summary the tool supplied, and are dropped
 * entirely when it supplied none. A transcript that rendered raw tool JSON would
 * read as a debug console, and the argument payloads are not the user's business.
 */
export function toEntries(messages: StoredMessage[]): TranscriptEntry[] {
  return messages.flatMap<TranscriptEntry>((message) => {
    if (message.role === "SYSTEM") return []

    if (message.role === "TOOL") {
      const visible = readUserVisible(message.toolResult)
      return visible
        ? [{ id: message.id, role: "activity", content: visible, at: message.createdAt.toISOString(), ...(message.toolName ? { tool: message.toolName } : {}) }]
        : []
    }

    // An assistant turn that carried only tool calls has no text to show. It is
    // still in the database, because the model needs it to make sense of its own
    // history; it is just not speech.
    if (message.content.trim().length === 0) return []

    return [
      {
        id: message.id,
        role: message.role === "USER" ? "user" : "assistant",
        content: message.content,
        at: message.createdAt.toISOString(),
      },
    ]
  })
}

function readUserVisible(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const stored = value as { userVisible?: unknown }
  return typeof stored.userVisible === "string" && stored.userVisible.length > 0 ? stored.userVisible : null
}

function readProductNames(source: Record<string, unknown> | null): string[] {
  if (!Array.isArray(source?.products)) return []
  return source.products.flatMap((entry) => {
    const product = asRecord(entry)
    return typeof product?.name === "string" ? [product.name] : []
  })
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
