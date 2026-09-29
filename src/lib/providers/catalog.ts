/**
 * Single source of truth for every generation provider and model the product
 * can present. A provider is either:
 *   - status "live": a real adapter exists and generation actually runs.
 *   - status "planned": credentials can be saved in the admin console, but
 *     generation is not wired yet (the model list is informational).
 *
 * The user-facing selector only offers LIVE models that also have a configured
 * credential. The admin console lists EVERY provider so keys can be captured
 * ahead of adapter support. Never put secrets in this file.
 */

export type CatalogKind = "IMAGE" | "VIDEO"
export type CatalogStatus = "live" | "planned"

export type CatalogModel = {
  /** Stable id sent to the API and stored as the configuration model. */
  id: string
  /** Human label shown in menus. */
  label: string
  /** Optional one-line hint (resolution, speed, cost tier, etc.). */
  hint?: string
}

export type CatalogProvider = {
  /** Stable provider key, lowercase. */
  key: string
  /** Display name. */
  label: string
  /** Emoji used across the premium UI. */
  emoji: string
  kind: CatalogKind
  status: CatalogStatus
  /** Env var / admin field label for the API key. */
  apiKeyEnvVar: string
  /** Placeholder shown in the admin key field. */
  apiKeyPlaceholder: string
  /** Where to get a key (shown as a hint). */
  docsUrl?: string
  models: CatalogModel[]
}

export const IMAGE_PROVIDERS: CatalogProvider[] = [
  {
    key: "bfl",
    label: "FLUX (Black Forest Labs)",
    emoji: "🎨",
    kind: "IMAGE",
    status: "live",
    apiKeyEnvVar: "BFL_API_KEY",
    apiKeyPlaceholder: "bfl-…",
    docsUrl: "https://docs.bfl.ai",
    models: [
      { id: "flux-2-pro", label: "FLUX.2 Pro", hint: "Premium quality, keeps the real product" },
      { id: "flux-2-flex", label: "FLUX.2 Flex", hint: "Best text and fine print, keeps the real product" },
      { id: "flux-2-max", label: "FLUX.2 Max", hint: "Highest fidelity, keeps the real product" },
    ],
  },
  {
    key: "openai",
    label: "OpenAI",
    emoji: "🖌️",
    kind: "IMAGE",
    status: "live",
    apiKeyEnvVar: "OPENAI_API_KEY",
    apiKeyPlaceholder: "sk-…",
    docsUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-image-2", label: "GPT Image 2", hint: "Latest; keeps the real product" },
      { id: "gpt-image-1.5", label: "GPT Image 1.5", hint: "Keeps the real product" },
      { id: "gpt-image-1-mini", label: "GPT Image 1 Mini", hint: "Lowest cost; keeps the real product" },
    ],
  },
  {
    key: "google",
    label: "Google Gemini (Nano Banana)",
    emoji: "🔮",
    kind: "IMAGE",
    status: "live",
    apiKeyEnvVar: "GEMINI_API_KEY",
    apiKeyPlaceholder: "AIza…",
    docsUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-3.1-flash-image", label: "Nano Banana 2 (Gemini 3.1 Flash Image)", hint: "Fast, ~$0.10/image, keeps the real product" },
      { id: "gemini-3-pro-image", label: "Nano Banana Pro (Gemini 3 Pro Image)", hint: "Highest quality, ~$0.13/image" },
      { id: "gemini-3.1-flash-lite-image", label: "Nano Banana Lite", hint: "Lowest cost, ~$0.03/image" },
    ],
  },
  {
    key: "stability",
    label: "Stability AI",
    emoji: "🌀",
    kind: "IMAGE",
    status: "planned",
    apiKeyEnvVar: "STABILITY_API_KEY",
    apiKeyPlaceholder: "sk-…",
    docsUrl: "https://platform.stability.ai",
    models: [
      { id: "stable-image-ultra", label: "Stable Image Ultra" },
      { id: "stable-image-core", label: "Stable Image Core" },
      { id: "sd3.5-large", label: "Stable Diffusion 3.5 Large" },
    ],
  },
  {
    key: "ideogram",
    label: "Ideogram",
    emoji: "🅰️",
    kind: "IMAGE",
    status: "planned",
    apiKeyEnvVar: "IDEOGRAM_API_KEY",
    apiKeyPlaceholder: "ideogram-…",
    docsUrl: "https://developer.ideogram.ai",
    models: [
      { id: "ideogram-v3", label: "Ideogram 3.0", hint: "Best-in-class text rendering" },
      { id: "ideogram-v2", label: "Ideogram 2.0" },
    ],
  },
]

export const VIDEO_PROVIDERS: CatalogProvider[] = [
  {
    key: "seedance",
    label: "Seedance (ByteDance)",
    emoji: "🎥",
    kind: "VIDEO",
    status: "live",
    apiKeyEnvVar: "ARK_API_KEY",
    apiKeyPlaceholder: "BytePlus ModelArk API key",
    docsUrl: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey",
    // Ids and limits come from seedance-models.ts, the one source the service,
    // the form and the cost estimate all read.
    models: [
      { id: "dreamina-seedance-2-5-260628", label: "Seedance 2.5", hint: "Up to 30 s in one take, sound, draft preview" },
      { id: "dreamina-seedance-2-0-260128", label: "Seedance 2.0", hint: "Up to 15 s, sound" },
      { id: "dreamina-seedance-2-0-fast-260128", label: "Seedance 2.0 Fast", hint: "Up to 15 s, lower cost" },
      { id: "dreamina-seedance-2-0-mini-260615", label: "Seedance 2.0 Mini", hint: "Up to 15 s, lowest cost, good for tests" },
    ],
  },
  {
    key: "bfl",
    label: "FLUX 3 Video (Black Forest Labs)",
    emoji: "🎬",
    kind: "VIDEO",
    status: "live",
    apiKeyEnvVar: "BFL_API_KEY",
    apiKeyPlaceholder: "bfl-…",
    docsUrl: "https://docs.bfl.ai",
    models: [
      { id: "flux-3-video", label: "FLUX 3 Video", hint: "Multi-keyframe, one continuous render" },
    ],
  },
  {
    key: "runway",
    label: "Runway",
    emoji: "🎞️",
    kind: "VIDEO",
    status: "live",
    apiKeyEnvVar: "RUNWAYML_API_SECRET",
    apiKeyPlaceholder: "key-…",
    docsUrl: "https://docs.dev.runwayml.com",
    models: [
      { id: "gen4.5", label: "Gen-4.5", hint: "Latest image-to-video" },
      { id: "gen4_turbo", label: "Gen-4 Turbo", hint: "Faster" },
      { id: "gen3a_turbo", label: "Gen-3 Alpha Turbo" },
    ],
  },
  {
    key: "google",
    label: "Google Veo",
    emoji: "🔮",
    kind: "VIDEO",
    status: "live",
    apiKeyEnvVar: "GEMINI_API_KEY",
    apiKeyPlaceholder: "AIza…",
    docsUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast", hint: "4–8 s clips with sound, $0.10/s" },
      { id: "veo-3.1-generate-preview", label: "Veo 3.1", hint: "Highest quality, $0.40/s" },
      { id: "veo-3.1-lite-generate-preview", label: "Veo 3.1 Lite", hint: "Lowest cost, $0.05/s" },
    ],
  },
  {
    key: "kling",
    label: "Kling AI",
    emoji: "⚡",
    kind: "VIDEO",
    status: "live",
    apiKeyEnvVar: "KLING_API_KEY",
    apiKeyPlaceholder: "Kling API key",
    docsUrl: "https://kling.ai/document-api/guides/get-started/overview",
    models: [
      { id: "kling-3.0", label: "Kling 3.0", hint: "3–15 s with sound, first + last frame" },
      { id: "kling-3.0-turbo", label: "Kling 3.0 Turbo", hint: "3–15 s with sound, lower cost" },
    ],
  },
  {
    key: "luma",
    label: "Luma Dream Machine",
    emoji: "🌙",
    kind: "VIDEO",
    status: "planned",
    apiKeyEnvVar: "LUMA_API_KEY",
    apiKeyPlaceholder: "luma-…",
    docsUrl: "https://lumalabs.ai/dream-machine/api",
    models: [
      { id: "ray-2", label: "Ray 2" },
      { id: "ray-1.6", label: "Ray 1.6" },
    ],
  },
]

export function catalogProviders(kind: CatalogKind): CatalogProvider[] {
  return kind === "IMAGE" ? IMAGE_PROVIDERS : VIDEO_PROVIDERS
}

export function findCatalogProvider(kind: CatalogKind, key: string): CatalogProvider | undefined {
  return catalogProviders(kind).find((provider) => provider.key === key)
}

export function isLiveProvider(kind: CatalogKind, key: string): boolean {
  return findCatalogProvider(kind, key)?.status === "live"
}
