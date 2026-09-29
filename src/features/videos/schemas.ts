import { z } from "zod"

import { klingModel, veoModel } from "@/lib/providers/videos/clip-models"
import { seedanceModel } from "@/lib/providers/videos/seedance-models"

/**
 * Union of every aspect ratio any provider can render. The schema only enforces
 * that the value is one a provider *could* support; whether the SELECTED
 * provider supports it is validated separately via `providerSupportsAspectRatio`
 * before submission.
 */
export const aspectRatios = ["16:9", "9:16", "1:1", "4:5", "4:3", "3:4"] as const
export type AspectRatio = (typeof aspectRatios)[number]

export type VideoProviderName = "runway" | "bfl" | "seedance" | "google" | "kling"

// Per-provider capability tables. Runway image-to-video and FLUX 3 video accept
// overlapping-but-different ratio sets; validate before ever contacting them.
const providerAspectRatios: Record<VideoProviderName, ReadonlySet<AspectRatio>> = {
  runway: new Set<AspectRatio>(["16:9", "9:16", "1:1", "4:5"]),
  bfl: new Set<AspectRatio>(["16:9", "9:16", "1:1", "4:3", "3:4"]),
  seedance: new Set<AspectRatio>(["9:16", "16:9", "1:1", "3:4", "4:3"]),
  google: new Set<AspectRatio>(["9:16", "16:9"]),
  // Kling keeps the first frame's shape; the choice records the intended format.
  kling: new Set<AspectRatio>(["9:16", "16:9", "1:1", "4:5", "3:4", "4:3"]),
}

/** Existing Runway / FLUX range, unchanged. */
const LEGACY_DURATION = { min: 5, max: 20 }

/**
 * Seconds a provider/model accepts in ONE render. Checked before any call so an
 * out-of-range request is a 400 the user can fix, not a paid provider rejection.
 */
export function durationRangeFor(provider: VideoProviderName, model?: string | null): { min: number; max: number } {
  const options = durationOptionsFor(provider, model)
  return { min: options[0], max: options[options.length - 1] }
}

/** The exact lengths a provider/model accepts (Veo: 4, 6 or 8 only). */
export function durationOptionsFor(provider: VideoProviderName, model?: string | null): number[] {
  if (provider === "seedance") {
    const spec = seedanceModel(model) ?? seedanceModel("dreamina-seedance-2-5-260628")!
    return steps(spec.minSeconds, spec.maxSeconds)
  }
  if (provider === "google") return veoModel(model).durations
  if (provider === "kling") return klingModel(model).durations
  return steps(LEGACY_DURATION.min, LEGACY_DURATION.max)
}

function steps(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index)
}

export function providerSupportsAspectRatio(provider: VideoProviderName, aspectRatio: AspectRatio): boolean {
  return providerAspectRatios[provider].has(aspectRatio)
}

/**
 * Ordered list of aspect ratios the given provider supports, in the canonical
 * `aspectRatios` order. Used to render only the ratio options a provider can
 * actually accept.
 */
export function supportedAspectRatiosFor(provider: VideoProviderName): AspectRatio[] {
  return aspectRatios.filter((ratio) => providerAspectRatios[provider].has(ratio))
}

export const motionStyles = ["UGC", "PRODUCT_360", "CINEMATIC", "PRODUCT_COMMERCIAL", "LUXURY", "DYNAMIC", "MINIMAL", "CUSTOM"] as const

export const videoInputSchema = z.object({
  projectId: z.string().cuid(),
  // Seedance prompts carry a shot plan for 20–30 s reels, so allow more room.
  prompt: z.string().trim().min(8).max(2000),
  motionStyle: z.enum(motionStyles),
  // The union of every provider's range; the chosen model's own range is enforced
  // by `durationRangeFor` in the service.
  duration: z.number().int().min(3).max(30),
  aspectRatio: z.enum(aspectRatios),
  // Optional user model choice. These select which provider/model renders the
  // video; they carry no ownership meaning (the server still derives the source
  // images from the project's saved selections).
  provider: z.enum(["runway", "bfl", "seedance", "google", "kling"]).optional(),
  model: z.string().max(100).optional(),
  /** Seedance 2.5: render a 480p draft first; the final is rendered on approval. */
  draft: z.boolean().optional(),
  /** Seedance, Veo, Kling: output resolution (Seedance drafts are always 480p). */
  resolution: z.enum(["480p", "720p", "1080p"]).optional(),
  /** Seedance, Kling 3.0: synchronised sound — voice, ambience, music. */
  generateAudio: z.boolean().optional(),
})

export type VideoInput = z.infer<typeof videoInputSchema>
