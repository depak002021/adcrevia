export type VideoTaskState = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED"
export type VideoAspectRatio = "16:9" | "9:16" | "1:1" | "4:5" | "4:3" | "3:4"

export type VideoSourceImage = { id: string; url: string; position: number }

export type VideoGenerationInput = {
  sourceImages: VideoSourceImage[]
  prompt: string
  duration: number
  aspectRatio: VideoAspectRatio
  /** Photos of the exact product (our stored copies). Used by reference-capable providers. */
  referenceImages?: string[]
  /** Seedance 2.5: render a cheap 480p draft that can later be finalised. */
  draft?: boolean
  /** Output resolution for providers that offer a choice (Seedance). */
  resolution?: "480p" | "720p" | "1080p"
  /** Synchronised sound (voice, ambience, music) where the provider supports it. */
  generateAudio?: boolean
}

export type VideoCreateResult = { taskId: string; taskMetadata?: Record<string, unknown> }

export type VideoTaskStatus = {
  state: VideoTaskState
  progress?: number
  outputUrl?: string
  errorCode?: string
  /** Billable units the provider reported for the finished task (Seedance: tokens). */
  usage?: { tokens?: number }
}

export interface VideoProvider {
  readonly name: "runway" | "bfl" | "seedance" | "google" | "kling"
  readonly model: string
  create(input: VideoGenerationInput): Promise<VideoCreateResult>
  getStatus(taskId: string, taskMetadata?: Record<string, unknown>): Promise<VideoTaskStatus>
  /** For outputs that need credentials to download (Veo); otherwise the URL is fetched plainly. */
  download?(url: string): Promise<{ bytes: Uint8Array; contentType: string }>
}
