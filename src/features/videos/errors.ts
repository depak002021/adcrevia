import { VideoProviderError } from "@/lib/providers/videos/errors"

import { VideoWorkflowError } from "./service"

/**
 * One place that turns a video failure into what the user sees.
 *
 * Messages say what to do next. Only safe codes are read — never a provider body,
 * which can echo prompts, keys or account details.
 */

const CONFIG_ERROR_MESSAGES = new Set([
  "RUNWAYML_API_SECRET is required",
  "BFL_API_KEY is required",
  "ARK_API_KEY is required",
  "OPENAI_API_KEY is required",
  "R2_STORAGE_CONFIG_REQUIRED",
])

const WORKFLOW: Record<string, [number, string]> = {
  SELECTED_IMAGE_REQUIRED: [422, "Select a completed image before creating a video."],
  ASPECT_RATIO_UNSUPPORTED: [400, "That aspect ratio is not available for this model."],
  TOO_MANY_SOURCE_IMAGES: [400, "Too many scenes are selected for one video."],
  DURATION_UNSUPPORTED: [400, "That length is not available for this model. Pick one from the list."],
  DRAFT_UNSUPPORTED: [400, "Draft preview is available on Seedance 2.5 only."],
  RESOLUTION_UNSUPPORTED: [400, "That resolution is not available for this model."],
  NOT_A_DRAFT: [400, "Only a Seedance draft can be rendered as a final video."],
  DRAFT_NOT_READY: [409, "The draft is still rendering. Try again when it has finished."],
  DRAFT_EXPIRED: [410, "Drafts can be finalised for seven days. Generate a new draft."],
  VIDEO_NOT_FOUND: [404, "That video could not be found."],
  REEL_NOT_NEEDED: [400, "This model can make that length in one video, or the length needs more than six clips."],
}

const PROVIDER: Record<string, [number, string]> = {
  PROVIDER_AUTHENTICATION_FAILED: [503, "The video provider rejected the API key. Ask an admin to check it in Video providers."],
  PROVIDER_MODEL_NOT_ACTIVATED: [503, "This model is not activated on the provider account yet. Activate it in the BytePlus console."],
  PROVIDER_BILLING: [503, "The video provider account needs a top-up before it can render."],
  PROVIDER_RATE_LIMIT: [429, "The video provider is busy. Try again in a minute."],
  PROVIDER_MODERATED: [422, "The provider declined this content. Adjust the prompt or the images and try again."],
  DURATION_UNSUPPORTED: WORKFLOW.DURATION_UNSUPPORTED,
  DRAFT_UNSUPPORTED: WORKFLOW.DRAFT_UNSUPPORTED,
  RESOLUTION_UNSUPPORTED: WORKFLOW.RESOLUTION_UNSUPPORTED,
  ASPECT_RATIO_UNSUPPORTED: WORKFLOW.ASPECT_RATIO_UNSUPPORTED,
  PROVIDER_REJECTED: [422, "The video provider rejected this request. Try a different model or adjust the prompt."],
  PROVIDER_UNAVAILABLE: [503, "The video provider is temporarily unavailable. Try again in a minute."],
  SOURCE_IMAGE_UNAVAILABLE: [422, "A selected scene could not be read. Regenerate it and try again."],
}

export function videoErrorResponse(error: unknown, fallback: string): Response {
  // Multi-source requests aimed at Runway must switch provider.
  if (error instanceof VideoProviderError && error.safeCode === "MULTI_IMAGE_REQUIRES_FLUX") {
    return Response.json({ error: "This selection needs the multi-image video provider.", code: error.safeCode }, { status: 422 })
  }
  if (error instanceof VideoWorkflowError && WORKFLOW[error.code]) {
    const [status, message] = WORKFLOW[error.code]
    return Response.json({ error: message, code: error.code }, { status })
  }
  if (error instanceof VideoProviderError && PROVIDER[error.safeCode]) {
    const [status, message] = PROVIDER[error.safeCode]
    return Response.json({ error: message, code: error.safeCode }, { status })
  }
  if (error instanceof Error && CONFIG_ERROR_MESSAGES.has(error.message)) {
    return Response.json({ error: "The video provider is not configured yet." }, { status: 503 })
  }
  if (error && typeof error === "object" && "issues" in error) {
    return Response.json({ error: "Check the video settings and try again." }, { status: 400 })
  }
  // An unrecognised model id is a bad request, not an upstream failure.
  if (error instanceof Error && (error.message === "UNKNOWN_PROVIDER_MODEL" || error.message === "UNKNOWN_PROVIDER")) {
    return Response.json(
      { error: "That video model is not available. Pick one from the list and try again.", code: error.message },
      { status: 400 },
    )
  }
  // Unexpected: log the safe category (never a body or key) so it can be diagnosed.
  console.error("[videos] unhandled failure", {
    name: error instanceof Error ? error.name : typeof error,
    code: error instanceof VideoProviderError ? error.safeCode : error instanceof Error ? error.message.slice(0, 80) : undefined,
  })
  return Response.json({ error: fallback }, { status: 502 })
}
