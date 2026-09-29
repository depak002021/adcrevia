import { z } from "zod"

import { BflClient, BflProviderError } from "@/lib/providers/bfl"

import type { VideoAspectRatio, VideoCreateResult, VideoGenerationInput, VideoProvider, VideoTaskStatus } from "./types"

const RESOLUTION = "hd"

// FLUX 3 video accepts a fixed set of aspect ratios. Every ratio the video
// input schema advertises for BFL must have an entry here so the `Record`
// stays exhaustive and no submission is ever sent an undefined ratio.
const aspectRatioMap: Record<VideoAspectRatio, string> = {
  "16:9": "16:9",
  "9:16": "9:16",
  "1:1": "1:1",
  "4:5": "4:5",
  "4:3": "4:3",
  "3:4": "3:4",
}

// Bounded, non-fabricated progress hints for in-flight polling states. The
// values only communicate relative advancement; they never claim completion.
const RUNNING_PROGRESS: Record<string, number> = {
  Pending: 0,
  Reasoning: 10,
  Generating: 50,
}

const QUEUED_STATUSES = new Set(["Pending", "Queued", "Request Accepted"])
const RUNNING_STATUSES = new Set(["Reasoning", "Generating"])
const MODERATION_STATUSES = new Set(["Content Moderated", "Request Moderated"])

const pollResultSchema = z.object({
  status: z.string().min(1),
  result: z.object({ sample: z.string().url() }).partial().optional(),
})

/**
 * Minimum clip length required to place `count` keyframes at whole-second
 * offsets: keyframes are spread across the timeline, so N sources need at least
 * N-1 seconds, and we never generate a clip shorter than 5 seconds.
 */
export function minimumDurationForSources(count: number): number {
  return Math.max(5, count - 1)
}

/**
 * Deterministic keyframe payload. A single source is sent as its bare URL; two
 * or more sources are spread evenly across the requested duration as
 * `[timestamp, url]` tuples.
 */
export function keyframesFor(input: VideoGenerationInput): string | Array<[number, string]> {
  if (input.sourceImages.length === 1) return input.sourceImages[0].url
  return input.sourceImages.map(
    (image, index) =>
      [Number(((index * input.duration) / (input.sourceImages.length - 1)).toFixed(2)), image.url] as [number, string],
  )
}

export type FluxVideoProviderOptions = {
  apiKey: string
  model?: string
  fetch?: typeof fetch
  baseUrl?: string
  deadlineMs?: number
  now?: () => number
}

export class FluxVideoProvider implements VideoProvider {
  readonly name = "bfl" as const
  readonly model: string
  private readonly client: BflClient
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch

  constructor(options: FluxVideoProviderOptions) {
    if (!options.apiKey) throw new Error("BFL_API_KEY is required")
    this.apiKey = options.apiKey
    this.model = options.model ?? "flux-3-video"
    this.fetchImpl = options.fetch ?? fetch
    this.client = new BflClient({
      apiKey: options.apiKey,
      fetch: this.fetchImpl,
      baseUrl: options.baseUrl,
      deadlineMs: options.deadlineMs,
      now: options.now,
    })
  }

  async create(input: VideoGenerationInput): Promise<VideoCreateResult> {
    this.assertDuration(input)
    const submission = await this.client.submit(this.model, {
      mode: "i2v",
      keyframes: keyframesFor(input),
      prompt: input.prompt,
      duration: input.duration,
      aspect_ratio: aspectRatioMap[input.aspectRatio],
      resolution: RESOLUTION,
      generate_audio: true,
    })
    // The polling URL is an implementation detail of the refresh path; it is
    // carried in metadata so it is never mistaken for a task identifier.
    // bflCredits: what BFL charged for this render, recorded as its cost on completion.
    return { taskId: submission.id, taskMetadata: { pollingUrl: submission.pollingUrl, bflCredits: submission.cost ?? null } }
  }

  async getStatus(_taskId: string, taskMetadata?: Record<string, unknown>): Promise<VideoTaskStatus> {
    const pollingUrl = taskMetadata?.pollingUrl
    if (typeof pollingUrl !== "string" || pollingUrl.length === 0) {
      throw new BflProviderError("PROVIDER_INVALID_RESPONSE")
    }

    const response = await this.request(pollingUrl)
    this.assertOk(response)
    const parsed = pollResultSchema.safeParse(await this.readJson(response))
    if (!parsed.success) throw new BflProviderError("PROVIDER_INVALID_RESPONSE", response.status)

    const { status, result } = parsed.data
    if (status === "Ready") {
      if (!result?.sample) return { state: "FAILED", errorCode: "PROVIDER_OUTPUT_MISSING" }
      return { state: "SUCCEEDED", outputUrl: result.sample }
    }
    if (QUEUED_STATUSES.has(status)) return { state: "QUEUED", progress: RUNNING_PROGRESS[status] ?? 0 }
    if (RUNNING_STATUSES.has(status)) return { state: "RUNNING", progress: RUNNING_PROGRESS[status] ?? 0 }
    if (MODERATION_STATUSES.has(status)) return { state: "FAILED", errorCode: "PROVIDER_MODERATED" }
    return { state: "FAILED", errorCode: "VIDEO_PROVIDER_FAILED" }
  }

  private assertDuration(input: VideoGenerationInput): void {
    const minimum = minimumDurationForSources(input.sourceImages.length)
    const withinRange = Number.isInteger(input.duration) && input.duration >= minimum && input.duration <= 60
    if (!withinRange) throw new BflProviderError("PROVIDER_REJECTED")
  }

  private async request(url: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method: "GET",
        headers: { "x-key": this.apiKey, accept: "application/json" },
      })
    } catch {
      throw new BflProviderError("PROVIDER_UNAVAILABLE")
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      throw new BflProviderError("PROVIDER_INVALID_RESPONSE", response.status)
    }
  }

  private assertOk(response: Response): void {
    if (response.ok) return
    if (response.status === 401 || response.status === 403) {
      throw new BflProviderError("PROVIDER_AUTHENTICATION_FAILED", response.status)
    }
    if (response.status === 429) throw new BflProviderError("PROVIDER_RATE_LIMIT", response.status)
    if (response.status >= 500) throw new BflProviderError("PROVIDER_UNAVAILABLE", response.status)
    throw new BflProviderError("PROVIDER_REJECTED", response.status)
  }
}
