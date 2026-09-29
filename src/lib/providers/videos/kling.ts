import { VideoProviderError } from "./errors"
import { klingModel } from "./clip-models"
import type { VideoCreateResult, VideoGenerationInput, VideoProvider, VideoTaskStatus } from "./types"

/**
 * Kling 3.0 / 3.0 Turbo image-to-video, official API with a Kling API key.
 *
 *   POST https://api-singapore.klingai.com/image-to-video/{model}   → data.id
 *   GET  https://api-singapore.klingai.com/tasks?task_ids={id}       → data[0]
 *
 * Kling keeps the first frame's shape (there is no aspect setting), accepts 3–15 s,
 * and reads JPEG/PNG frames only — our generated frames and product photos are
 * stored as JPEG for that reason. With several scenes, Kling 3.0 also takes the last
 * scene as the closing frame. Result URLs are kept 30 days; we copy them at once.
 */

const DEFAULT_BASE_URL = "https://api-singapore.klingai.com"

type Fetcher = typeof fetch

export type KlingOptions = { apiKey: string; model?: string; baseUrl?: string; fetch?: Fetcher }

export class KlingVideoProvider implements VideoProvider {
  readonly name = "kling" as const
  readonly model: string
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: Fetcher

  constructor(options: KlingOptions) {
    if (!options.apiKey) throw new Error("KLING_API_KEY is required")
    this.apiKey = options.apiKey
    this.model = klingModel(options.model).id
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")
    this.fetchImpl = options.fetch ?? fetch
  }

  async create(input: VideoGenerationInput): Promise<VideoCreateResult> {
    const spec = klingModel(this.model)
    if (!spec.durations.includes(input.duration)) throw new VideoProviderError("DURATION_UNSUPPORTED")
    if (input.sourceImages.length === 0) throw new VideoProviderError("SOURCE_IMAGE_REQUIRED")
    const resolution = input.resolution === "1080p" ? "1080p" : "720p"

    const first = input.sourceImages[0].url
    const last = input.sourceImages.length > 1 && spec.lastFrame ? input.sourceImages[input.sourceImages.length - 1].url : null
    const contents: Array<Record<string, unknown>> = [
      { type: "prompt", text: input.prompt.slice(0, 2500) },
      { type: "first_frame", url: klingImage(first) },
      ...(last ? [{ type: "last_frame", url: klingImage(last) }] : []),
    ]
    const settings: Record<string, unknown> = { resolution, duration: input.duration }
    // Turbo always renders sound and has no switch; 3.0 takes native|off.
    if (spec.audioOptional) {
      settings.audio = input.generateAudio === false ? "off" : "native"
      settings.multi_shot = false
    }

    const created = await this.request<{ data?: { id?: string } }>("POST", `/image-to-video/${this.model}`, {
      contents,
      settings,
      options: { watermark_info: { enabled: false } },
    })
    const id = created.data?.id
    if (!id) throw new VideoProviderError("PROVIDER_INVALID_RESPONSE")
    return { taskId: id, taskMetadata: { resolution, duration: input.duration } }
  }

  async getStatus(taskId: string): Promise<VideoTaskStatus> {
    const result = await this.request<{ data?: KlingTask[] }>("GET", `/tasks?task_ids=${encodeURIComponent(taskId)}`)
    const task = result.data?.find((item) => item.id === taskId) ?? result.data?.[0]
    switch (task?.status) {
      case "submitted":
        return { state: "QUEUED" }
      case "processing":
        return { state: "RUNNING" }
      case "succeeded": {
        const url = task.outputs?.find((output) => output.type === "video")?.url
        return url ? { state: "SUCCEEDED", outputUrl: url } : { state: "FAILED", errorCode: "PROVIDER_OUTPUT_MISSING" }
      }
      case "failed":
        return { state: "FAILED", errorCode: /risk|security|sensitive|policy|content/i.test(task.message ?? "") ? "PROVIDER_MODERATED" : "PROVIDER_REJECTED" }
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
    const payload = (await response.json().catch(() => null)) as (T & { code?: number; message?: string }) | null
    const code = payload?.code
    if (!response.ok || (typeof code === "number" && code !== 0)) {
      // Server log only: Kling's service code and short message, never the key or body.
      console.warn("[kling] request refused", { status: response.status, code, message: payload?.message?.slice(0, 240) })
      throw new VideoProviderError(klingError(response.status, code))
    }
    if (!payload) throw new VideoProviderError("PROVIDER_INVALID_RESPONSE")
    return payload
  }
}

type KlingTask = {
  id?: string
  status?: string
  message?: string
  outputs?: Array<{ type?: string; url?: string }>
}

/** Kling takes a URL or raw Base64 (no `data:` prefix). */
export function klingImage(url: string): string {
  const match = url.match(/^data:[^;]+;base64,(.*)$/)
  return match ? match[1] : url
}

/** Kling's service codes (document-api/api/get-started/error-codes) → safe codes. */
export function klingError(status: number, code: number | undefined): string {
  if (code !== undefined && code >= 1000 && code <= 1004) return "PROVIDER_AUTHENTICATION_FAILED"
  if (code === 1101 || code === 1102) return "PROVIDER_BILLING"
  if (code === 1103 || code === 1203) return "PROVIDER_MODEL_NOT_ACTIVATED"
  if (code === 1300 || code === 1301) return "PROVIDER_MODERATED"
  if (code === 1302 || code === 1303) return "PROVIDER_RATE_LIMIT"
  if (status === 401) return "PROVIDER_AUTHENTICATION_FAILED"
  if (status === 429) return "PROVIDER_RATE_LIMIT"
  if (status >= 500) return "PROVIDER_UNAVAILABLE"
  return "PROVIDER_REJECTED"
}
