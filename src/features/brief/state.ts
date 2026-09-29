import type { ConversationPhase } from "@/generated/prisma/enums"
import { getPrisma } from "@/lib/db/prisma"
import { productPhotosFrom } from "@/features/projects/references"

/**
 * The state the brief reasons over.
 *
 * Assembled once per step and handed to both the agent and the classifier, so the
 * two cannot disagree about what is known. Field names matter here: the decision
 * questions refer to them (`website.products`, `product.prompt`), so renaming one
 * silently changes what a question means.
 *
 * Only facts. No page excerpts, no crawl telemetry, no derived scores — the model
 * is being asked what it knows about a product, not to audit a crawl.
 */

export type BriefWebsiteState = {
  url: string
  title: string | null
  brandName: string | null
  /** Candidate products found on the site, most likely first. */
  products: Array<{ name: string; description: string | null; url: string | null; price: string | null }>
  palette: string[]
  logo: string | null
  analyzed: boolean
  safeErrorCode: string | null
  /** The link is a product page, and `products[0]` is that product. */
  primaryProduct: boolean
}

export type BriefState = {
  projectId: string
  phase: ConversationPhase
  completeness: number
  product: {
    /** What the user typed, verbatim. The highest-signal field in the state. */
    prompt: string
    enhanced: string | null
    /** Structured facts recorded so far, from the site or from the conversation. */
    facts: Record<string, unknown> | null
    /** Real photos of the product the images and videos will copy exactly. */
    photos: { uploaded: number; fromWebsite: number }
  }
  website: BriefWebsiteState | null
  palette: string[]
  directions: Array<{ position: number; title: string; mood: string }>
  images: { target: number; completed: number; failed: number }
  hasVideo: boolean
}

export async function readBriefState(projectId: string): Promise<BriefState | null> {
  const project = await getPrisma().project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      targetImageCount: true,
      prompt: { select: { original: true, enhanced: true, productJson: true } },
      websiteReference: { select: { url: true, title: true, analysis: true, safeErrorCode: true, analyzedAt: true } },
      brandPalette: { select: { colors: true } },
      directions: { orderBy: { position: "asc" }, select: { position: true, title: true, mood: true } },
      images: { select: { status: true } },
      conversation: { select: { phase: true, completeness: true } },
      videos: { select: { id: true }, take: 1 },
    },
  })

  if (!project) return null

  return {
    projectId: project.id,
    phase: project.conversation?.phase ?? "DISCOVERY",
    completeness: project.conversation?.completeness ?? 0,
    product: {
      prompt: project.prompt?.original ?? "",
      enhanced: project.prompt?.enhanced ?? null,
      facts: withoutPhotoLinks(asRecord(project.prompt?.productJson)),
      photos: (() => {
        const photos = productPhotosFrom(project.prompt?.productJson)
        return { uploaded: photos.uploaded.length, fromWebsite: photos.fromWebsite.length }
      })(),
    },
    website: project.websiteReference ? websiteState(project.websiteReference) : null,
    palette: asStringArray(project.brandPalette?.colors),
    directions: project.directions.map((direction) => ({
      position: direction.position,
      title: direction.title,
      mood: direction.mood,
    })),
    images: {
      target: project.targetImageCount,
      completed: project.images.filter((image) => image.status === "COMPLETED").length,
      failed: project.images.filter((image) => image.status === "FAILED").length,
    },
    hasVideo: project.videos.length > 0,
  }
}

function websiteState(reference: {
  url: string
  title: string | null
  analysis: unknown
  safeErrorCode: string | null
  analyzedAt: Date | null
}): BriefWebsiteState {
  const analysis = asRecord(reference.analysis)
  return {
    url: reference.url,
    title: reference.title,
    brandName: readBrandName(analysis),
    // Capped: a catalogue site can yield dozens, and the question being asked is
    // "which one did the user mean", which the top few answer.
    products: readProducts(analysis).slice(0, 8),
    palette: readPalette(analysis),
    logo: typeof analysis?.logo === "string" ? analysis.logo : null,
    analyzed: reference.analyzedAt !== null && reference.safeErrorCode === null,
    safeErrorCode: reference.safeErrorCode,
    primaryProduct: analysis?.hasPrimaryProduct === true,
  }
}

function readBrandName(analysis: Record<string, unknown> | null): string | null {
  if (!analysis) return null
  const brand = asRecord(analysis.brand)
  if (typeof brand?.name === "string") return brand.name
  return typeof analysis.siteName === "string" ? analysis.siteName : null
}

function readProducts(analysis: Record<string, unknown> | null): BriefWebsiteState["products"] {
  if (!Array.isArray(analysis?.products)) return []
  return analysis.products.flatMap((entry) => {
    const product = asRecord(entry)
    if (!product || typeof product.name !== "string") return []
    return [
      {
        name: product.name,
        description: typeof product.description === "string" ? product.description : null,
        url: typeof product.url === "string" ? product.url : null,
        price: typeof product.price === "string" ? product.price : null,
      },
    ]
  })
}

function readPalette(analysis: Record<string, unknown> | null): string[] {
  if (!Array.isArray(analysis?.colors)) return []
  return analysis.colors.flatMap((entry) => {
    if (typeof entry === "string") return [entry]
    const color = asRecord(entry)
    return typeof color?.hex === "string" ? [color.hex] : []
  })
}

/** Photo URL lists are counted in `photos`; as raw links they only cost tokens. */
function withoutPhotoLinks(facts: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!facts) return null
  const rest = Object.fromEntries(Object.entries(facts).filter(([key]) => !/image|photo|reference/i.test(key)))
  return Object.keys(rest).length ? rest : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

/**
 * Render the state as the system turn the agent sees.
 *
 * A separate turn rather than part of the instructions, so the recorded
 * `promptTemplateId` genuinely reproduces the instructions that were used. State
 * changes every step; the template does not.
 */
export function renderStateForAgent(state: BriefState): string {
  return [
    "Current project state (read-only, refreshed every step):",
    JSON.stringify(
      {
        phase: state.phase,
        completeness: state.completeness,
        product: state.product,
        website: state.website,
        palette: state.palette,
        directions: state.directions,
        images: state.images,
      },
      null,
      1,
    ),
  ].join("\n")
}
