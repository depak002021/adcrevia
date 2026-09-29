import { Prisma } from "@/generated/prisma/client"
import { getPrisma } from "@/lib/db/prisma"
import type { WebsiteAnalysis } from "./analyzer"
import type { StoredReference } from "./references"

/**
 * Persist an analysis so the model can actually see it.
 *
 * This closes the most consequential gap in the previous implementation: the
 * analyser ran, produced a result, returned it to the browser, and stored
 * nothing. `WebsiteReference.analysis`, `.title`, `.analyzedAt` and
 * `.safeErrorCode` were declared in the schema and never written by any code
 * path, so `PromptContext.website.analysis` — the field handed to the model when
 * composing creative directions — was always `null`. Every brand fetch was
 * decorative.
 */

/**
 * The shape written to `Prompt.productJson`.
 *
 * Kept narrower than the full analysis on purpose. This is the structured product
 * understanding the brief reasons over, so it holds facts rather than crawl
 * telemetry: no page lists, no notes, no excerpt.
 */
export type ProductUnderstanding = {
  source: "website"
  sourceUrl: string
  brandName: string | null
  products: WebsiteAnalysis["products"]
  palette: string[]
  typography: string[]
  logo: string | null
  heroImages: string[]
  /**
   * The product's own photos, copied to our storage (see references.ts). These are
   * what image and video generators receive as "the product". Empty when the page
   * is not about a single product, or when no photo could be copied.
   */
  referenceImages: string[]
  capturedAt: string
}

export async function persistWebsiteAnalysis(
  projectId: string,
  analysis: WebsiteAnalysis,
  references: StoredReference[] = [],
): Promise<void> {
  const db = getPrisma()

  const understanding: ProductUnderstanding = {
    source: "website",
    sourceUrl: analysis.finalUrl,
    brandName: analysis.brand?.name ?? analysis.siteName,
    products: analysis.products,
    palette: analysis.colors.map((color) => color.hex),
    typography: analysis.typography,
    logo: analysis.logo,
    heroImages: analysis.heroImages,
    referenceImages: references.map((reference) => reference.url),
    capturedAt: analysis.extractedAt,
  }

  await db.$transaction(async (transaction) => {
    // `upsert` rather than `update`: a project created without a website URL has
    // no WebsiteReference row, and analysing one later has to create it.
    await transaction.websiteReference.upsert({
      where: { projectId },
      create: {
        projectId,
        url: analysis.finalUrl,
        title: analysis.title,
        analysis: toJson(analysis),
        analyzedAt: new Date(),
        safeErrorCode: null,
      },
      update: {
        // The final URL is stored, not the requested one, so a later re-analysis
        // follows the same destination rather than the redirect again.
        url: analysis.finalUrl,
        title: analysis.title,
        analysis: toJson(analysis),
        analyzedAt: new Date(),
        // Clears any previous failure, so a successful retry does not leave a
        // stale error on the row.
        safeErrorCode: null,
      },
    })

    // Photos the user uploaded are theirs, not the page's: a re-analysis keeps them.
    const existing = await transaction.prompt.findUnique({ where: { projectId }, select: { productJson: true } })
    const uploaded = (existing?.productJson as { uploadedReferences?: unknown } | null)?.uploadedReferences

    // The Prompt row is created with the project, so a missing one means the
    // project is gone; `updateMany` avoids throwing on that race.
    await transaction.prompt.updateMany({
      where: { projectId },
      data: { productJson: toJson({ ...understanding, ...(Array.isArray(uploaded) ? { uploadedReferences: uploaded } : {}) }) },
    })
  })
}

/**
 * Record that analysis failed.
 *
 * Stored so the brief can say "we could not read that site" on a later visit
 * instead of silently showing an empty field, and so the admin log has the reason.
 */
export async function persistWebsiteFailure(
  projectId: string,
  url: string,
  safeErrorCode: string,
): Promise<void> {
  const db = getPrisma()
  await db.websiteReference.upsert({
    where: { projectId },
    create: { projectId, url, safeErrorCode, analyzedAt: new Date() },
    update: { safeErrorCode, analyzedAt: new Date() },
  })
}

/**
 * Round-trip through JSON before writing.
 *
 * Prisma's JSON columns require `InputJsonValue`; casting an arbitrary object
 * through `any` would let a non-serialisable value (a Date, an undefined) reach
 * the driver and fail at query time. Serialising first guarantees it is storable.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
