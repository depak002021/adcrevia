import { VideoProviderError } from "./errors"
import { veoModel } from "./clip-models"
import type { VideoCreateResult, VideoGenerationInput, VideoProvider, VideoTaskStatus } from "./types"

/**
 * Google Veo 3.1 through the Gemini API.
 *
 *   POST {base}/models/{model}:predictLongRunning   → { name: "models/…/operations/…" }
 *   GET  {base}/{operation name}                    → { done, response | error }
 *   GET  video.uri with the API key                 → the MP4 (kept 2 days)
 *
 * Two modes, chosen by what the request can use:
 *   - Reference mode (Veo 3.1 / Fast, 8 s): the key frame plus up to two product
 *     photos as "asset" references, which keeps the product's look.
 *   - Frame mode: the first scene as the opening frame and, with several scenes,
 *     the last scene as the closing frame.
 * Veo only renders 16:9 or 9:16, 4–8 s, always with sound.
 */

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

type Fetcher = typeof fetch
/**
 * Veo's image shape. Google's docs show `inlineData`, but predictLongRunning rejects
 * it ("`inlineData` isn't supported by this model"); it accepts `bytesBase64Encoded`
 * for the first/last frame and for reference images. Verified against the live API
 * with deliberately invalid requests, so no render was started or billed.
 */
type InlineImage = { bytesBase64Encoded: string; mimeType: string }

export type VeoOptions = { apiKey: string; model?: string; baseUrl?: string; fetch?: Fetcher }

export class VeoVideoProvider implements VideoProvider {
  readonly name = "google" as const
  readonly model: string
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: Fetcher

  constructor(options: VeoOptions) {
    if (!options.apiKey) throw new Error("GEMINI_API_KEY is required")
    this.apiKey = options.apiKey
    this.model = veoModel(options.model).id
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")
    this.fetchImpl = options.fetch ?? fetch
  }

  async create(input: VideoGenerationInput): Promise<VideoCreateResult> {
    const spec = veoModel(this.model)
    if (input.aspectRatio !== "16:9" && input.aspectRatio !== "9:16") throw new VideoProviderError("ASPECT_RATIO_UNSUPPORTED")
    if (!spec.durations.includes(input.duration)) throw new VideoProviderError("DURATION_UNSUPPORTED")
    const resolution = input.resolution === "1080p" ? "1080p" : "720p"
    if (resolution === "1080p" && input.duration !== 8) throw new VideoProviderError("RESOLUTION_UNSUPPORTED")

    const scenes = input.sourceImages.map((image) => image.url)
    const product = (input.referenceImages ?? []).filter((url) => !scenes.includes(url))
    const referenceMode = spec.referenceImages > 0 && product.length > 0 && input.duration === 8

    const instance: Record<string, unknown> = { prompt: input.prompt }
    if (referenceMode) {
      const references = [scenes[0], ...product].filter(Boolean).slice(0, spec.referenceImages)
      instance.referenceImages = await Promise.all(
        references.map(async (url) => ({ image: await this.inline(url), referenceType: "asset" })),
      )
    } else if (scenes.length > 0) {
      instance.image = await this.inline(scenes[0])
      if (scenes.length > 1 && spec.lastFrame) instance.lastFrame = await this.inline(scenes[scenes.length - 1])
    }

    // personGeneration is deliberately NOT sent: Google's docs say image input needs
    // "allow_adult", but the live API answers that with "Your use case is currently
    // not supported" for this account; the default is accepted (verified).
    const parameters = { aspectRatio: input.aspectRatio, durationSeconds: input.duration, resolution }
    const submit = (body: Record<string, unknown>) =>
      this.request<{ name?: string }>("POST", `/models/${this.model}:predictLongRunning`, { instances: [body], parameters })

    let operation: { name?: string }
    let mode = referenceMode ? "reference" : instance.lastFrame ? "first-last" : "first"
    try {
      operation = await submit(instance)
    } catch (error) {
      // A refused request is not billed. If the richer mode (references or a closing
      // frame) is what Google refused, fall back once to the plain opening frame so
      // the user still gets a clip, rather than an error and a retry by hand.
      const fallbackPossible = mode !== "first" && scenes.length > 0
      if (!(error instanceof VideoProviderError && error.safeCode === "PROVIDER_REJECTED" && fallbackPossible)) throw error
      operation = await submit({ prompt: input.prompt, image: await this.inline(scenes[0]) })
      mode = "first (fallback)"
    }
    if (!operation.name) throw new VideoProviderError("PROVIDER_INVALID_RESPONSE")
    return {
      taskId: operation.name,
      taskMetadata: { resolution, duration: input.duration, mode },
    }
  }

  async getStatus(taskId: string): Promise<VideoTaskStatus> {
    if (!/^models\/[\w.-]+\/operations\/[\w-]+$/.test(taskId)) throw new VideoProviderError("PROVIDER_INVALID_RESPONSE")
    const operation = await this.request<VeoOperation>("GET", `/${taskId}`)
    if (!operation.done) return { state: "RUNNING" }
    if (operation.error) {
      return { state: "FAILED", errorCode: /safety|policy|block/i.test(operation.error.message ?? "") ? "PROVIDER_MODERATED" : "PROVIDER_REJECTED" }
    }
    const result = operation.response?.generateVideoResponse
    const uri = result?.generatedSamples?.[0]?.video?.uri
    if (uri) return { state: "SUCCEEDED", outputUrl: uri }
    // Responsible-AI filtering: done, no sample, and a filtered count. Not billed.
    if ((result?.raiMediaFilteredCount ?? 0) > 0) return { state: "FAILED", errorCode: "PROVIDER_MODERATED" }
    return { state: "FAILED", errorCode: "PROVIDER_OUTPUT_MISSING" }
  }

  /** Veo's file URI only serves the MP4 to a request carrying the API key. */
  async download(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    if (!url.startsWith("https://generativelanguage.googleapis.com/")) throw new VideoProviderError("PROVIDER_INVALID_RESPONSE")
    const response = await this.fetchImpl(url, {
      headers: { "x-goog-api-key": this.apiKey },
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null)
    if (!response?.ok) throw new VideoProviderError("PROVIDER_DOWNLOAD_FAILED")
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: "video/mp4" }
  }

  /** Our stored frames arrive as data URLs (see prepareImageForProvider). */
  private async inline(url: string): Promise<InlineImage> {
    const match = url.match(/^data:([^;]+);base64,(.*)$/)
    if (match) return { bytesBase64Encoded: match[2], mimeType: match[1] }
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null)
    if (!response?.ok) throw new VideoProviderError("SOURCE_IMAGE_UNAVAILABLE")
    return {
      bytesBase64Encoded: Buffer.from(await response.arrayBuffer()).toString("base64"),
      mimeType: (response.headers.get("content-type") ?? "image/jpeg").split(";")[0],
    }
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      })
    } catch {
      throw new VideoProviderError("PROVIDER_UNAVAILABLE")
    }
    const payload = (await response.json().catch(() => null)) as (T & { error?: { status?: string; message?: string } }) | null
    if (!response.ok) {
      // Server log only: Google's short reason, never the key or the request body.
      console.warn("[veo] request refused", { status: response.status, reason: payload?.error?.status, message: payload?.error?.message?.slice(0, 240) })
      throw new VideoProviderError(googleHttpError(response.status, payload?.error?.status))
    }
    if (!payload) throw new VideoProviderError("PROVIDER_INVALID_RESPONSE")
    return payload
  }
}

type VeoOperation = {
  done?: boolean
  error?: { code?: number; message?: string }
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>
      raiMediaFilteredCount?: number
    }
  }
}

export function googleHttpError(status: number, reason: string | undefined): string {
  if (status === 401 || status === 403 || reason === "PERMISSION_DENIED" || reason === "UNAUTHENTICATED") return "PROVIDER_AUTHENTICATION_FAILED"
  if (status === 429 || reason === "RESOURCE_EXHAUSTED") return "PROVIDER_RATE_LIMIT"
  if (status === 404) return "PROVIDER_MODEL_NOT_ACTIVATED"
  if (status >= 500) return "PROVIDER_UNAVAILABLE"
  if (reason === "FAILED_PRECONDITION") return "PROVIDER_BILLING"
  return "PROVIDER_REJECTED"
}
