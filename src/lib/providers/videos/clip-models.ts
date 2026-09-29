/**
 * Google Veo and Kling model capabilities and list prices, as pure data so the
 * video form, the server checks and the cost log all agree.
 *
 * Sources (checked 2026-09-25):
 *   Veo:   ai.google.dev/gemini-api/docs/veo (parameters table) and /pricing
 *   Kling: kling.ai/document-api (capability map, 3.0 / 3.0 Turbo image-to-video, pricing)
 */

export type ClipModelSpec = {
  id: string
  label: string
  /** Exact lengths the model accepts, in seconds. */
  durations: number[]
  resolutions: Array<"720p" | "1080p">
  /** USD per second of output, by resolution (with audio, which these models add). */
  usdPerSecond: Record<"720p" | "1080p", number>
  /** Product photos as references (Veo: "asset" images; forces 8 s). */
  referenceImages: number
  /** A second frame as the ending shot. */
  lastFrame: boolean
  /** Sound can be switched off (otherwise always on). */
  audioOptional: boolean
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index)

export const VEO_MODELS: ClipModelSpec[] = [
  {
    id: "veo-3.1-fast-generate-preview",
    label: "Veo 3.1 Fast",
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p"],
    usdPerSecond: { "720p": 0.1, "1080p": 0.12 },
    referenceImages: 3,
    lastFrame: true,
    audioOptional: false,
  },
  {
    id: "veo-3.1-generate-preview",
    label: "Veo 3.1",
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p"],
    usdPerSecond: { "720p": 0.4, "1080p": 0.4 },
    referenceImages: 3,
    lastFrame: true,
    audioOptional: false,
  },
  {
    id: "veo-3.1-lite-generate-preview",
    label: "Veo 3.1 Lite",
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p"],
    usdPerSecond: { "720p": 0.05, "1080p": 0.08 },
    referenceImages: 0,
    lastFrame: true,
    audioOptional: false,
  },
]

export const KLING_MODELS: ClipModelSpec[] = [
  {
    id: "kling-3.0",
    label: "Kling 3.0",
    durations: range(3, 15),
    resolutions: ["720p", "1080p"],
    usdPerSecond: { "720p": 0.126, "1080p": 0.168 },
    referenceImages: 0,
    lastFrame: true,
    audioOptional: true,
  },
  {
    id: "kling-3.0-turbo",
    label: "Kling 3.0 Turbo",
    durations: range(3, 15),
    resolutions: ["720p", "1080p"],
    usdPerSecond: { "720p": 0.112, "1080p": 0.14 },
    referenceImages: 0,
    lastFrame: false,
    audioOptional: false,
  },
]

export const DEFAULT_VEO_MODEL = VEO_MODELS[0].id
export const DEFAULT_KLING_MODEL = KLING_MODELS[0].id

/** A saved model the provider no longer offers (veo-3.0-generate, kling-v2) maps to the default. */
export function veoModel(id: string | null | undefined): ClipModelSpec {
  return VEO_MODELS.find((model) => model.id === id) ?? VEO_MODELS[0]
}

export function klingModel(id: string | null | undefined): ClipModelSpec {
  return KLING_MODELS.find((model) => model.id === id) ?? KLING_MODELS[0]
}

export function estimateClipCostUsd(spec: ClipModelSpec, seconds: number, resolution: "720p" | "1080p" = "720p"): number {
  return Math.round(spec.usdPerSecond[resolution] * seconds * 1000) / 1000
}
