/**
 * The best quality for the cost, measured on the live service: Nano Banana 2 keeps
 * the real product from its photos (no refusals in the logs), Veo 3.1 Lite renders
 * a clip in under a minute at $0.05 a second. Preselected in the pickers and used
 * when a run starts without a choice, whenever the provider is configured.
 */
export const RECOMMENDED_IMAGE_MODEL = "gemini-3.1-flash-image"
export const RECOMMENDED_IMAGE_CHOICE = { provider: "google" as const, model: RECOMMENDED_IMAGE_MODEL }
export const RECOMMENDED_VIDEO_MODEL = "veo-3.1-lite-generate-preview"
