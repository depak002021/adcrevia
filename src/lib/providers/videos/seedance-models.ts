/**
 * ByteDance Seedance (BytePlus ModelArk) model capabilities and pricing.
 *
 * Pure data with no server imports, so the video form can show the same duration
 * limits and cost estimate the server enforces and logs.
 *
 * Source: BytePlus ModelArk docs, "Dreamina Seedance 2.5 tutorial" and "Model billing"
 * (checked 2026-09-25). Prices are list prices in USD per million output tokens for
 * inputs WITHOUT reference video, which is how this product calls the model.
 *
 * Token formula (from the billing page, verified against its worked prices):
 *   tokens = duration × width × height × 24 fps / 1024
 * e.g. 720p (1280×720), 5 s: 108,000 tokens × $10.70/M = $1.156, matching BytePlus.
 */

export type SeedanceResolution = "480p" | "720p" | "1080p"

export type SeedanceModelSpec = {
  id: string
  label: string
  minSeconds: number
  maxSeconds: number
  resolutions: SeedanceResolution[]
  /** Draft mode: a cheap 480p preview that can then be rendered as the final video. */
  draft: boolean
  /** Reference images accepted per request. */
  maxReferenceImages: number
  /** USD per million tokens, by output resolution. */
  usdPerMillionTokens: Record<SeedanceResolution, number>
}

export const SEEDANCE_MODELS: SeedanceModelSpec[] = [
  {
    id: "dreamina-seedance-2-5-260628",
    label: "Seedance 2.5",
    minSeconds: 4,
    maxSeconds: 30,
    resolutions: ["480p", "720p", "1080p"],
    draft: true,
    maxReferenceImages: 30,
    usdPerMillionTokens: { "480p": 10.7, "720p": 10.7, "1080p": 11.7 },
  },
  {
    id: "dreamina-seedance-2-0-260128",
    label: "Seedance 2.0",
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["480p", "720p", "1080p"],
    draft: false,
    maxReferenceImages: 9,
    usdPerMillionTokens: { "480p": 7, "720p": 7, "1080p": 7.7 },
  },
  {
    id: "dreamina-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast",
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["480p", "720p"],
    draft: false,
    maxReferenceImages: 9,
    usdPerMillionTokens: { "480p": 5.6, "720p": 5.6, "1080p": 5.6 },
  },
  {
    id: "dreamina-seedance-2-0-mini-260615",
    label: "Seedance 2.0 Mini",
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["480p", "720p"],
    draft: false,
    maxReferenceImages: 9,
    usdPerMillionTokens: { "480p": 3.5, "720p": 3.5, "1080p": 3.5 },
  },
]

export const DEFAULT_SEEDANCE_MODEL = SEEDANCE_MODELS[0].id
/** H.264, plays everywhere. 1080p from Seedance 2.5 is H.265 10-bit and is transcoded. */
export const DEFAULT_SEEDANCE_RESOLUTION: SeedanceResolution = "720p"
/** A draft is always 480p; its final is always 1080p (BytePlus rule). */
export const DRAFT_RESOLUTION: SeedanceResolution = "480p"
export const DRAFT_FINAL_RESOLUTION: SeedanceResolution = "1080p"
/** BytePlus keeps a draft task usable for a final render for seven days. */
export const DRAFT_VALID_MS = 7 * 24 * 60 * 60 * 1000

const PIXELS: Record<SeedanceResolution, number> = {
  "480p": 854 * 480,
  "720p": 1280 * 720,
  "1080p": 1920 * 1080,
}

export function seedanceModel(id: string | null | undefined): SeedanceModelSpec | undefined {
  return SEEDANCE_MODELS.find((model) => model.id === id)
}

export function estimateSeedanceTokens(seconds: number, resolution: SeedanceResolution): number {
  return Math.round((seconds * PIXELS[resolution] * 24) / 1024)
}

/** Estimated USD for one render, before the call. */
export function estimateSeedanceCostUsd(modelId: string, seconds: number, resolution: SeedanceResolution): number | null {
  const model = seedanceModel(modelId)
  if (!model) return null
  return roundCents((estimateSeedanceTokens(seconds, resolution) * model.usdPerMillionTokens[resolution]) / 1_000_000)
}

/** Actual USD from the token count BytePlus reports after the render. */
export function seedanceCostFromTokens(modelId: string, tokens: number, resolution: SeedanceResolution): number | null {
  const model = seedanceModel(modelId)
  if (!model || !Number.isFinite(tokens)) return null
  return roundCents((tokens * model.usdPerMillionTokens[resolution]) / 1_000_000)
}

function roundCents(value: number) {
  return Math.round(value * 1000) / 1000
}
