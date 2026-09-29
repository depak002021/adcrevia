import { z } from "zod"

import { Prisma } from "@/generated/prisma/client"
import { createDirections } from "@/features/directions/service"
import { assertPublicHttpUrl } from "@/features/website/url-policy"
import { defineTool, type AnyAgentTool } from "@/lib/agent/types"
import { getPrisma } from "@/lib/db/prisma"
import { scheduleImageRun, scheduleWebsiteScrape } from "@/lib/jobs/schedule"

/**
 * What the brief agent can actually do.
 *
 * Deliberately few, and each one either records a fact or starts a job. There is no
 * tool that "thinks" — reasoning belongs in the model's turn, and a tool that only
 * reformats its input is a step of the budget spent on nothing.
 *
 * Every tool that costs money, mutates durable state or reaches a remote host is
 * marked `guarded`, which routes it through the pre-flight classifier before it
 * runs. The unguarded ones are the two that cannot do damage: reading the state
 * back, and asking the user a question.
 */

export type BriefToolDependencies = {
  projectId: string
  userId: string
  /** Called when a tool wants a line shown in the transcript. */
  narrate?(line: string): Promise<void>
}

export function createBriefTools(dependencies: BriefToolDependencies): AnyAgentTool[] {
  return [
    readWebsiteTool(dependencies),
    recordBriefTool(dependencies),
    setImageCountTool(dependencies),
    proposeDirectionsTool(dependencies),
    startGenerationTool(dependencies),
  ]
}

/**
 * Queue a crawl of the brand site.
 *
 * Returns as soon as the job is queued rather than waiting for the crawl. A crawl
 * reads up to eight pages with politeness delays, which is longer than an agent
 * step should hold a lease, and the queue already reports its progress to the same
 * event stream the conversation is rendered in. The scrape schedules the next agent
 * step when it finishes, so the agent picks the results up with them already in its
 * state.
 */
function readWebsiteTool(dependencies: BriefToolDependencies): AnyAgentTool {
  return defineTool({
    name: "read_website",
    description:
      "Queue a crawl of a brand or product website to extract the brand name, products, palette and logo. Use when the user gives a URL, or mentions a brand whose site they have named. Returns immediately; the results appear in the project state shortly afterwards.",
    input: z.object({
      url: z.string().min(4).max(2048).describe("The site to read. A full https URL."),
    }),
    guarded: true,
    async execute({ url }) {
      // The real enforcement is in `safeFetch` at request time, which re-resolves
      // DNS at connect. This is the early, explainable rejection so an obviously
      // unusable URL never becomes a job at all.
      try {
        await assertPublicHttpUrl(url)
      } catch (error) {
        return {
          ok: false,
          safeErrorCode: error instanceof Error ? error.message : "PUBLIC_HTTP_URL_REQUIRED",
        }
      }

      // The link given on the create screen is already being read (or has been):
      // a second crawl of it only repeats the work.
      const existing = await getPrisma().websiteReference.findUnique({
        where: { projectId: dependencies.projectId },
        select: { url: true, analyzedAt: true, safeErrorCode: true },
      })
      if (existing && sameAddress(existing.url, url)) {
        return {
          ok: true,
          output: {
            alreadyQueued: existing.analyzedAt === null,
            alreadyRead: existing.analyzedAt !== null && existing.safeErrorCode === null,
            note: "This link is already read or being read; its results are in the project state. Do not call read_website for it again.",
          },
        }
      }

      const job = await scheduleWebsiteScrape({ projectId: dependencies.projectId, url })
      await dependencies.narrate?.(`Reading ${hostOf(url)}`)
      return {
        ok: true,
        output: {
          queued: true,
          jobId: job.id,
          note: "The crawl runs in the background. Tell the user you are reading the site; the results will be in the project state on a later step.",
        },
        userVisible: `Reading ${hostOf(url)}`,
      }
    },
  })
}

/**
 * Write down what has been established about the product.
 *
 * This is the tool that makes the conversation worth having: without it the agent
 * asks good questions and then forgets the answers, because the transcript is not
 * something the image prompts read. The facts land on `Prompt.productJson`, which
 * is already what `PromptContext` hands the image model.
 */
function recordBriefTool(dependencies: BriefToolDependencies): AnyAgentTool {
  return defineTool({
    name: "record_brief",
    description:
      "Record what is now known about the product so later steps and the image prompts can use it. Call this whenever the user supplies or corrects a fact. Send only the fields you are confident about; omitted fields are left as they were.",
    input: z.object({
      productName: z.string().min(1).max(160).optional(),
      productSummary: z
        .string()
        .min(10)
        .max(1200)
        .optional()
        .describe("One or two sentences describing the product as a photographer would need it."),
      physicalDetail: z.string().max(600).optional().describe("Material, finish, colour, size, form."),
      audience: z.string().max(400).optional(),
      mood: z.string().max(400).optional().describe("The feeling the campaign should have."),
      usageContext: z.string().max(400).optional().describe("Where the images will run."),
      palette: z
        .array(z.string().regex(/^#[0-9A-Fa-f]{6}$/))
        .max(8)
        .optional()
        .describe("Uppercase six-digit hex colours."),
      confirmedProductUrl: z
        .string()
        .max(2048)
        .optional()
        .describe("Set once the user has confirmed which product from the site is the right one."),
    }),
    guarded: true,
    async execute(facts) {
      await dependencies.narrate?.("Noting what matters about the product")
      const db = getPrisma()
      const existing = await db.prompt.findUnique({
        where: { projectId: dependencies.projectId },
        select: { productJson: true },
      })

      // Merged rather than replaced: the crawl writes here too, and a turn that
      // only establishes the mood must not erase the product it found.
      const merged = {
        ...(asRecord(existing?.productJson) ?? {}),
        ...prune(facts),
        source: "conversation",
        updatedAt: new Date().toISOString(),
      }

      await db.prompt.updateMany({
        where: { projectId: dependencies.projectId },
        data: { productJson: toJson(merged) },
      })

      if (facts.palette?.length) {
        const colors = facts.palette.map((color) => color.toUpperCase())
        await db.brandPalette.upsert({
          where: { projectId: dependencies.projectId },
          create: { projectId: dependencies.projectId, colors, derived: false },
          // `derived: false` marks a palette that came from a person, so a later
          // automatic suggestion does not quietly overwrite a deliberate choice.
          update: { colors, derived: false },
        })
      }

      return { ok: true, output: { recorded: Object.keys(prune(facts)) } }
    },
  })
}

/** How many concepts to shoot. Cheap, reversible, and the user often asks. */
function setImageCountTool(dependencies: BriefToolDependencies): AnyAgentTool {
  return defineTool({
    name: "set_image_count",
    description:
      "Set how many distinct campaign concepts to generate. Only call this when the user asks for a specific number.",
    input: z.object({ count: z.number().int().min(1).max(10) }),
    guarded: true,
    async execute({ count }) {
      await getPrisma().project.updateMany({
        where: { id: dependencies.projectId, userId: dependencies.userId },
        data: { targetImageCount: count },
      })
      return { ok: true, output: { targetImageCount: count } }
    },
  })
}

/**
 * Propose the creative directions.
 *
 * Costs a model call, so it is guarded — but on the weaker bar: it is blocked only
 * when the brief is confidently NOT ready. Directions are cheap and thrown away
 * freely, and showing the user something to react to is often the fastest way to
 * find out what they actually want.
 */
function proposeDirectionsTool(dependencies: BriefToolDependencies): AnyAgentTool {
  return defineTool({
    name: "propose_directions",
    description:
      "Generate one distinct creative direction per planned concept, from everything known so far. Call this once the product and the intended feeling are clear. Replaces any previous directions.",
    input: z.object({}),
    guarded: true,
    async execute(_input, context) {
      await context.heartbeat()
      const planned = await getPrisma().project.findFirst({
        where: { id: dependencies.projectId, userId: dependencies.userId },
        select: { targetImageCount: true },
      })
      await dependencies.narrate?.(`Planning ${planned?.targetImageCount ?? "the"} shots from your brief`)
      const directions = await createDirections(dependencies.projectId, dependencies.userId)
      await dependencies.narrate?.("Writing up the shot list")
      return {
        ok: true,
        output: {
          directions: directions.map((direction) => ({
            position: direction.position,
            title: direction.title,
            mood: direction.mood,
          })),
        },
        userVisible: `Planned ${directions.length} shot${directions.length === 1 ? "" : "s"}`,
      }
    },
  })
}

/**
 * Start the image run.
 *
 * The only tool that spends provider credits at scale, so it is on the strict bar:
 * the brief must be confidently ready. The directions check is repeated here
 * because the agent can reach this tool without having called `propose_directions`,
 * and the orchestrator would otherwise start a run with nothing to render.
 */
function startGenerationTool(dependencies: BriefToolDependencies): AnyAgentTool {
  return defineTool({
    name: "start_generation",
    description:
      "Start generating the campaign images. Only call this when the brief is complete, directions exist, and the user has asked to proceed.",
    input: z.object({}),
    guarded: true,
    async execute() {
      const project = await getPrisma().project.findFirst({
        where: { id: dependencies.projectId, userId: dependencies.userId },
        select: { id: true, targetImageCount: true, _count: { select: { directions: true } } },
      })
      if (!project) return { ok: false, safeErrorCode: "PROJECT_NOT_FOUND" }

      if (project._count.directions !== project.targetImageCount) {
        return {
          ok: false,
          safeErrorCode: "DIRECTIONS_REQUIRED",
          output: {
            expected: project.targetImageCount,
            found: project._count.directions,
            note: "Call propose_directions first.",
          },
        }
      }

      const job = await scheduleImageRun({ projectId: project.id })
      return {
        ok: true,
        output: { queued: true, jobId: job.id, concepts: project.targetImageCount },
        userVisible: "Starting the shoot",
      }
    },
  })
}

/** Same page, ignoring scheme, "www.", trailing slash, query and fragment. */
function sameAddress(a: string, b: string): boolean {
  const key = (value: string) => {
    try {
      const parsed = new URL(value)
      return `${parsed.host.replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}`.toLowerCase()
    } catch {
      return value.toLowerCase()
    }
  }
  return key(a) === key(b)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Drop the keys the model omitted, so an absent field does not erase a known one. */
function prune(facts: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
