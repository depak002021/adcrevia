import { getPrisma } from "@/lib/db/prisma"
import { prepareImageForProvider } from "@/lib/storage/provider-assets"

/**
 * The product photos saved when the brand page was analysed (Prompt.productJson,
 * written by features/website/persist.ts), prepared for a provider to read.
 * Shared by image and video generation so both show the same product.
 */
export async function readProjectReferences(projectId: string): Promise<string[]> {
  const prompt = await getPrisma().prompt.findUnique({ where: { projectId }, select: { productJson: true } })
  return Promise.all(referenceUrlsFrom(prompt?.productJson).map((url) => prepareImageForProvider(url)))
}

/** Most photos any generator is sent as "the product". */
export const MAX_PRODUCT_PHOTOS = 6

/**
 * The product's photos, uploaded ones first (the user chose them), then those copied
 * from the product page, without duplicates.
 */
export function referenceUrlsFrom(productJson: unknown): string[] {
  const { uploaded, fromWebsite } = productPhotosFrom(productJson)
  return [...new Set([...uploaded, ...fromWebsite])].slice(0, MAX_PRODUCT_PHOTOS)
}

export function productPhotosFrom(productJson: unknown): { uploaded: string[]; fromWebsite: string[] } {
  if (!productJson || typeof productJson !== "object" || Array.isArray(productJson)) return { uploaded: [], fromWebsite: [] }
  const record = productJson as { referenceImages?: unknown; uploadedReferences?: unknown }
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((url): url is string => typeof url === "string") : [])
  return { uploaded: strings(record.uploadedReferences), fromWebsite: strings(record.referenceImages) }
}
