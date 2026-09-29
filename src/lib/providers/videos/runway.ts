import RunwayML from "@runwayml/sdk"

import { aspectRatioUnsupportedError, multiImageRequiresFluxError, normalizeRunwayError } from "./errors"
import type { VideoAspectRatio, VideoCreateResult, VideoGenerationInput, VideoProvider, VideoTaskStatus } from "./types"

type RunwayClientLike = {
  imageToVideo: { create(input: Record<string, unknown>): Promise<{ id: string }> }
  tasks: { retrieve(taskId: string): Promise<Record<string, unknown>> }
}

// Runway image-to-video supports only these four ratios. The map is keyed by
// the full `VideoAspectRatio` union (Partial) so the compiler forces us to
// handle a possibly-unmapped ratio rather than silently sending undefined.
const ratioMap: Partial<Record<VideoAspectRatio, string>> = {
  "16:9": "1280:720",
  "9:16": "720:1280",
  "1:1": "960:960",
  "4:5": "832:1104",
}

export class RunwayVideoProvider implements VideoProvider {
  readonly name = "runway" as const
  readonly model: string
  private readonly client: RunwayClientLike

  constructor(client?: RunwayClientLike, model = process.env.RUNWAY_VIDEO_MODEL ?? "gen4.5", apiKey = process.env.RUNWAYML_API_SECRET) {
    this.model = model
    if (client) {
      this.client = client
      return
    }
    if (!apiKey) throw new Error("RUNWAYML_API_SECRET is required")
    this.client = new RunwayML({ apiKey }) as unknown as RunwayClientLike
  }

  async create(input: VideoGenerationInput): Promise<VideoCreateResult> {
    if (input.sourceImages.length !== 1) {
      // Runway image-to-video accepts exactly one source; reject before any SDK
      // submission so multi-source requests are routed to the FLUX 3 provider.
      throw multiImageRequiresFluxError()
    }
    const ratio = ratioMap[input.aspectRatio]
    if (!ratio) {
      // Capability is validated upstream; guard here so an unsupported ratio is
      // rejected with a safe code instead of submitting an undefined value.
      throw aspectRatioUnsupportedError()
    }
    try {
      const task = await this.client.imageToVideo.create({
        model: this.model,
        promptImage: input.sourceImages[0].url,
        promptText: input.prompt,
        duration: input.duration,
        ratio,
      })
      return { taskId: task.id }
    } catch (error) {
      throw normalizeRunwayError(error)
    }
  }

  async getStatus(taskId: string): Promise<VideoTaskStatus> {
    try {
      const task = await this.client.tasks.retrieve(taskId)
      switch (task.status) {
        case "PENDING":
        case "THROTTLED":
          return { state: "QUEUED" }
        case "RUNNING":
          return typeof task.progress === "number"
            ? { state: "RUNNING", progress: Math.round(Math.max(0, Math.min(1, task.progress)) * 100) }
            : { state: "RUNNING" }
        case "SUCCEEDED": {
          const output = Array.isArray(task.output) ? task.output.find((value): value is string => typeof value === "string") : undefined
          return output ? { state: "SUCCEEDED", outputUrl: output } : { state: "FAILED", errorCode: "PROVIDER_OUTPUT_MISSING" }
        }
        case "FAILED":
          return { state: "FAILED", errorCode: "PROVIDER_REJECTED" }
        case "CANCELLED":
          return { state: "FAILED", errorCode: "PROVIDER_CANCELLED" }
        default:
          return { state: "FAILED", errorCode: "PROVIDER_STATUS_UNKNOWN" }
      }
    } catch (error) {
      throw normalizeRunwayError(error)
    }
  }
}
