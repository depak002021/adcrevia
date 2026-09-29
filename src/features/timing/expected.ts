/**
 * How long a render usually takes, per model: the median of its latest successful
 * runs in the generation logs, or a default until it has history. This is what the
 * countdowns show, so they track reality (Kling Turbo averaged 7.5 minutes while
 * the screen said "2 to 5").
 */

export type ExpectedTimes = { images: Record<string, number>; videos: Record<string, number> }

/** Defaults in ms, from renders measured on the live service (Sep 2026). */
export const DEFAULT_IMAGE_MS: Record<string, number> = {
  "gemini-3.1-flash-image": 22_000,
  "gemini-3.1-flash-lite-image": 7_000,
  "gemini-3-pro-image": 40_000,
  "gpt-image-1-mini": 40_000,
  "gpt-image-1.5": 55_000,
  "gpt-image-2": 60_000,
  "flux-2-pro": 25_000,
  "flux-2-flex": 35_000,
  "flux-2-max": 45_000,
}

export const DEFAULT_VIDEO_MS: Record<string, number> = {
  "veo-3.1-lite-generate-preview": 50_000,
  "veo-3.1-fast-generate-preview": 65_000,
  "veo-3.1-generate-preview": 100_000,
  "kling-3.0-turbo": 450_000,
  "kling-3.0": 480_000,
  "flux-3-video": 270_000,
}

const FALLBACK_IMAGE_MS = 30_000
const FALLBACK_VIDEO_MS = 180_000
/** Joining clips into a reel: ffmpeg transitions and loudness pass. */
export const REEL_JOIN_MS = 30_000

export function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

export function expectedImageMs(times: ExpectedTimes | null, model: string | null | undefined): number {
  return (model && (times?.images[model] ?? DEFAULT_IMAGE_MS[model])) || FALLBACK_IMAGE_MS
}

export function expectedVideoMs(times: ExpectedTimes | null, model: string | null | undefined): number {
  return (model && (times?.videos[model] ?? DEFAULT_VIDEO_MS[model])) || FALLBACK_VIDEO_MS
}

/** Clips of a reel render in parallel, then they are joined. */
export function expectedReelMs(times: ExpectedTimes | null, model: string | null | undefined): number {
  return expectedVideoMs(times, model) + REEL_JOIN_MS
}
