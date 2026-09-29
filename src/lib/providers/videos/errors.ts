export class VideoProviderError extends Error {
  constructor(public readonly safeCode: string) {
    super(safeCode)
    this.name = "VideoProviderError"
  }
}

/**
 * Raised by Runway when more than one source image is supplied. Multi-keyframe
 * generation is only supported by the FLUX 3 provider, so callers must switch
 * providers rather than silently dropping images.
 */
export function multiImageRequiresFluxError() {
  return new VideoProviderError("MULTI_IMAGE_REQUIRES_FLUX")
}

/**
 * Raised when a provider is asked to render an aspect ratio outside its
 * supported set. The service validates capability before submission, so this
 * is a defensive guard that surfaces a safe capability code instead of sending
 * the provider an undefined ratio.
 */
export function aspectRatioUnsupportedError() {
  return new VideoProviderError("ASPECT_RATIO_UNSUPPORTED")
}

export function normalizeRunwayError(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status)
    if (status === 429) return new VideoProviderError("PROVIDER_RATE_LIMIT")
    if (status >= 500) return new VideoProviderError("PROVIDER_UNAVAILABLE")
    if (status >= 400) return new VideoProviderError("PROVIDER_REJECTED")
  }
  return new VideoProviderError("VIDEO_PROVIDER_FAILED")
}
