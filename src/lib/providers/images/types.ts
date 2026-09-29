import type { Cost } from "@/lib/costs/pricing"

import type { ImageFormat } from "./formats"

export type ImageGenerationInput = {
  projectId: string
  imageId: string
  position: number
  prompt: string
  /**
   * Photos of the actual product (our stored copies), used as visual references by
   * providers that support them. Absent or empty means text-only generation.
   */
  referenceImages?: string[]
  /** Frame shape; providers map it to their own sizes. Absent = legacy 3:2. */
  format?: ImageFormat
}

/**
 * Prefix telling a reference-capable model what the attached photos are for.
 * Shared so every provider asks for the same thing in the same words.
 */
/**
 * Tell the model the reference images are the product.
 *
 * Two wordings. "strict" spells out design, print and logo placement, which keeps
 * the product exact on Gemini. "neutral" says the same thing without asking to
 * reproduce a logo or design: FLUX (BFL) flags that wording as "Protected Content"
 * and refuses the request, charging for it, and OpenAI applies a similar filter.
 */
export function withProductReference(prompt: string, referenceCount: number, wording: "strict" | "neutral" = "strict"): string {
  if (referenceCount === 0) return prompt
  if (wording === "neutral") {
    return (
      `Use the product shown in the reference ${referenceCount === 1 ? "image" : "images"} as the product in this scene, ` +
      `keeping its shape, colours, materials and details consistent with the reference. ${prompt}`
    )
  }
  const images = referenceCount === 1 ? "image 1" : `images 1-${referenceCount}`
  return (
    `The product in ${images} is the exact product to feature. Reproduce it faithfully: same design, ` +
    `print and graphics, colours, logo placement, material and proportions. Do not redesign or restyle ` +
    `the product itself; only the scene, styling, people and lighting may change. ${prompt}`
  )
}

export type ImageProviderName = "openai" | "bfl" | "google"

export type ImageGenerationResult = {
  bytes: Uint8Array
  contentType: string
  provider: ImageProviderName
  model: string
  providerAssetId?: string
  width?: number
  height?: number
  /** What this image cost, from the provider's own figures (null when it gave none). */
  cost?: Cost | null
}

export interface ImageProvider {
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult>
}
