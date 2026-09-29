import { Prisma } from "@/generated/prisma/client"
import { openAiTextCost } from "@/lib/costs/pricing"
import { getPrisma } from "@/lib/db/prisma"
import { HttpError } from "@/lib/http/http-error"
import { createOpenAITextProvider } from "@/lib/providers/runtime"

import { readSocialCopy, tidySocialCopy, type SocialCopy } from "./schema"

/**
 * Social captions for a project.
 *
 * Written only when the user asks (one text call, a fraction of a cent) and stored,
 * so reading them again, sharing and downloading never call a model. The input is
 * everything already known about the product: the user's own words, the facts read
 * from the product page, the brand and the creative directions.
 */

export async function getSocialCopy(projectId: string, userId: string): Promise<SocialCopy | null> {
  const prompt = await getPrisma().prompt.findFirst({ where: { projectId, project: { userId } }, select: { socialCopy: true } })
  if (!prompt) throw new HttpError(404, "Project not found")
  return readSocialCopy(prompt.socialCopy)
}

const FACT_KEYS = ["name", "brand", "description", "category", "price", "availability", "sku"] as const

/** Product facts without photo URL lists, which say nothing to a copywriter. */
function productFacts(productJson: unknown) {
  if (!productJson || typeof productJson !== "object" || Array.isArray(productJson)) return null
  const source = productJson as Record<string, unknown>
  const facts: Record<string, unknown> = {}
  for (const key of FACT_KEYS) if (source[key] !== undefined && source[key] !== null && source[key] !== "") facts[key] = source[key]
  return Object.keys(facts).length ? facts : null
}

function brandFrom(analysis: unknown): string | null {
  if (!analysis || typeof analysis !== "object") return null
  const value = analysis as { brand?: { name?: unknown }; siteName?: unknown }
  if (typeof value.brand?.name === "string") return value.brand.name
  return typeof value.siteName === "string" ? value.siteName : null
}

export async function writeSocialCopy(projectId: string, userId: string): Promise<SocialCopy> {
  const project = await getPrisma().project.findFirst({
    where: { id: projectId, userId },
    select: {
      name: true,
      imageFormat: true,
      prompt: { select: { original: true, enhanced: true, productJson: true } },
      websiteReference: { select: { url: true, title: true, analysis: true } },
      directions: { orderBy: { position: "asc" }, select: { title: true, mood: true, description: true } },
    },
  })
  if (!project?.prompt) throw new HttpError(404, "Project not found")

  const input = {
    brief: project.prompt.original,
    refinedBrief: project.prompt.enhanced,
    product: productFacts(project.prompt.productJson),
    brand: brandFrom(project.websiteReference?.analysis) ?? null,
    productPage: project.websiteReference ? { url: project.websiteReference.url, title: project.websiteReference.title } : null,
    creativeDirections: project.directions.map((direction) => ({ title: direction.title, mood: direction.mood, description: direction.description })),
  }

  const provider = await createOpenAITextProvider()
  const result = await provider.writeSocialCopy(input)
  const copy: SocialCopy = {
    ...tidySocialCopy(result.copy),
    meta_: {
      model: result.model,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
      costUsd: openAiTextCost(result.model, result.usage.input, result.usage.output),
      writtenAt: new Date().toISOString(),
    },
  }
  await getPrisma().prompt.update({ where: { projectId }, data: { socialCopy: copy as unknown as Prisma.InputJsonValue } })
  return copy
}
