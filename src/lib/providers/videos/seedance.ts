import { VideoProviderError } from "./errors"
import {
  DEFAULT_SEEDANCE_MODEL,
  DEFAULT_SEEDANCE_RESOLUTION,
  DRAFT_FINAL_RESOLUTION,
  DRAFT_RESOLUTION,
  seedanceModel,
} from "./seedance-models"
import type { VideoAspectRatio, VideoCreateResult, VideoGenerationInput, VideoProvider, VideoTaskStatus } from "./types"

/**
 * ByteDance Seedance through BytePlus ModelArk.
 *
 *   POST {base}/contents/generations/tasks     create (async)
 *   GET  {base}/contents/generations/tasks/:id poll
 *
 * Every image goes in as a `reference_image` ("omni reference"): the storyboard frames
 * the user selected, then photos of the actual product. Reference mode — unlike
 * first-frame mode — lets us set the aspect ratio explicitly (a 9:16 reel from 3:2
 * frames) and lets one request cover several scenes, which is how a 20–30 second reel
 * is a single call on Seedance 2.5 rather than several clips stitched together.
 *
 * Output URLs expire after 24 hours and may be downloaded at most 100 times; the
 * service copies the result to our storage once, as soon as the task succeeds.
 */

const DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"

const RATIOS: Partial<Record<VideoAspectRatio, string>> = {
  "16:9": "16:9",
  "9:16": "9:16",
  "1:1": "1:1",
  "4:3": "4:3",
  "3:4": "3:4",
}

export const SEEDANCE_ASPECT_RATIOS = Object.keys(RATIOS) as VideoAspectRatio[]

type Fetcher = typeof fetch

export type SeedanceOptions = { apiKey: string; model?: string; baseUrl?: string; fetch?: Fetcher }

export class SeedanceVideoProvider implements VideoProvider {
  readonly name = "seedance" as const
  readonly model: string
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: Fetcher

  constructor(options: SeedanceOptions) {
    if (!options.apiKey) throw new Error("ARK_API_KEY is required")
    this.apiKey = options.apiKey
    this.model = options.model ?? DEFAULT_SEEDANCE_MODEL
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")
    this.fetchImpl = options.fetch ?? fetch
  }

  async create(input: VideoGenerationInput): Promise<VideoCreateResult> {
    const spec = seedanceModel(this.model)
    const ratio = RATIOS[input.aspectRatio]
    if (!ratio) throw new VideoProviderError("ASPECT_RATIO_UNSUPPORTED")
    if (spec && (input.duration < spec.minSeconds || input.duration > spec.maxSeconds)) {
      throw new VideoProviderError("DURATION_UNSUPPORTED")
    }
    const draft = Boolean(input.draft)
    if (draft && !spec?.draft) throw new VideoProviderError("DRAFT_UNSUPPORTED")

    const resolution = draft ? DRAFT_RESOLUTION : (input.resolution ?? DEFAULT_SEEDANCE_RESOLUTION)
    if (spec && !spec.resolutions.includes(resolution)) throw new VideoProviderError("RESOLUTION_UNSUPPORTED")

    const images = planReferences(input, spec?.maxReferenceImages ?? 9)
    const body = {
      model: this.model,
      content: [
        { type: "text", text: seedancePrompt(input, images) },
        ...images.urls.map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" })),
      ],
      ratio,
      duration: input.duration,
      resolution,
      generate_audio: input.generateAudio ?? true,
      watermark: false,
      ...(draft ? { draft: true } : {}),
    }
    const created = await this.request<{ id?: string }>("POST", "/contents/generations/tasks", body)
    if (!created.id) throw new VideoProviderError("PROVIDER_INVALID_RESPONSE")
    return { taskId: created.id, taskMetadata: { resolution, draft, duration: input.duration } }
  }

  /**
   * Render the final video from an approved draft. BytePlus reuses the draft's
   * prompt, references, duration, ratio, seed and audio, and only renders 1080p.
   */
  async createFromDraft(draftTaskId: string): Promise<VideoCreateResult> {
    const created = await this.request<{ id?: string }>("POST", "/contents/generations/tasks", {
      model: this.model,
      content: [{ type: "draft_task", draft_task: { id: draftTaskId } }],
      resolution: DRAFT_FINAL_RESOLUTION,
      watermark: false,
    })
    if (!created.id) throw new VideoProviderError("PROVIDER_INVALID_RESPONSE")
    return { taskId: created.id, taskMetadata: { resolution: DRAFT_FINAL_RESOLUTION, draft: false, draftTaskId } }
  }

  async getStatus(taskId: string): Promise<VideoTaskStatus> {
    const task = await this.request<SeedanceTask>("GET", `/contents/generations/tasks/${encodeURIComponent(taskId)}`)
    const usage = typeof task.usage?.completion_tokens === "number" ? { tokens: task.usage.completion_tokens } : undefined
    switch (task.status) {
      case "queued":
        return { state: "QUEUED" }
      case "running":
        return { state: "RUNNING" }
      case "succeeded":
        return task.content?.video_url
          ? { state: "SUCCEEDED", outputUrl: task.content.video_url, usage }
          : { state: "FAILED", errorCode: "PROVIDER_OUTPUT_MISSING", usage }
      case "failed":
        return { state: "FAILED", errorCode: safeTaskError(task.error?.code), usage }
      case "cancelled":
        return { state: "FAILED", errorCode: "PROVIDER_CANCELLED" }
      case "expired":
        return { state: "FAILED", errorCode: "PROVIDER_TIMEOUT" }
      default:
        return { state: "FAILED", errorCode: "PROVIDER_STATUS_UNKNOWN" }
    }
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
    } catch {
      throw new VideoProviderError("PROVIDER_UNAVAILABLE")
    }
    const payload = (await response.json().catch(() => null)) as (T & { error?: { code?: string } }) | null
    if (!response.ok) {
      // Server log only: BytePlus's error code, never the key or the request body.
      console.warn("[seedance] request refused", { status: response.status, code: payload?.error?.code })
      throw new VideoProviderError(safeHttpError(response.status, payload?.error?.code))
    }
    if (!payload) throw new VideoProviderError("PROVIDER_INVALID_RESPONSE")
    return payload
  }
}

type SeedanceTask = {
  status?: string
  content?: { video_url?: string }
  error?: { code?: string } | null
  usage?: { completion_tokens?: number }
}

/** Storyboard frames first (in order), then product photos, within the model's limit. */
export function planReferences(input: Pick<VideoGenerationInput, "sourceImages" | "referenceImages">, max: number) {
  const scenes = input.sourceImages.slice(0, max).map((image) => image.url)
  const product = (input.referenceImages ?? []).filter((url) => !scenes.includes(url)).slice(0, Math.max(0, max - scenes.length))
  return { urls: [...scenes, ...product], sceneCount: scenes.length, productCount: product.length }
}

/**
 * The prompt with Seedance's `@ImageN` references spelled out: which images are the
 * storyboard, which are the product, and — for several scenes — a timed shot plan
 * that spreads the scenes across the requested duration.
 */
export function seedancePrompt(
  input: Pick<VideoGenerationInput, "prompt" | "duration">,
  images: { sceneCount: number; productCount: number },
): string {
  const lines: string[] = []
  const { sceneCount, productCount } = images

  if (sceneCount === 1) {
    lines.push("@Image1 is the key frame: keep its product, styling and art direction.")
  } else if (sceneCount > 1) {
    lines.push(`@Image1 to @Image${sceneCount} are the storyboard frames, in order.`)
  }
  if (productCount > 0) {
    const first = sceneCount + 1
    const last = sceneCount + productCount
    const which = productCount === 1 ? `@Image${first} is a photo` : `@Image${first} to @Image${last} are photos`
    lines.push(
      `${which} of the exact product. Keep its design, print, colours, logo and proportions identical in every shot; never redesign it.`,
    )
  }
  lines.push(input.prompt.trim())

  if (sceneCount > 1) {
    const shot = input.duration / sceneCount
    const plan = Array.from({ length: sceneCount }, (_, index) => {
      const from = Math.round(index * shot)
      const to = index === sceneCount - 1 ? input.duration : Math.round((index + 1) * shot)
      return `Shot ${index + 1} (${from}-${to}s): based on @Image${index + 1}.`
    })
    lines.push(`Shot plan: ${plan.join(" ")} Use smooth, motivated transitions between shots.`)
  }
  return lines.join("\n")
}

/**
 * HTTP failures → safe codes. The body can echo the prompt or account details, so
 * only its error code is read, and only to pick a category.
 */
export function safeHttpError(status: number, code: string | undefined): string {
  const value = code ?? ""
  if (status === 401 || /AuthenticationError|InvalidApiKey/i.test(value)) return "PROVIDER_AUTHENTICATION_FAILED"
  if (/ModelNotOpen|NotActivated|ModelNotFound/i.test(value)) return "PROVIDER_MODEL_NOT_ACTIVATED"
  if (/Overdue|InsufficientBalance|Quota|Billing/i.test(value)) return "PROVIDER_BILLING"
  if (/Sensitive|Risk|Moderat/i.test(value)) return "PROVIDER_MODERATED"
  if (status === 403) return "PROVIDER_AUTHENTICATION_FAILED"
  if (status === 429) return "PROVIDER_RATE_LIMIT"
  if (status >= 500) return "PROVIDER_UNAVAILABLE"
  return "PROVIDER_REJECTED"
}

function safeTaskError(code: string | undefined): string {
  if (!code) return "PROVIDER_REJECTED"
  if (/Sensitive|Risk|Moderat/i.test(code)) return "PROVIDER_MODERATED"
  if (/Overdue|InsufficientBalance|Quota/i.test(code)) return "PROVIDER_BILLING"
  if (/Timeout|Expired/i.test(code)) return "PROVIDER_TIMEOUT"
  return "PROVIDER_REJECTED"
}
