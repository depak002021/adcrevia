import { BflClient, BflProviderError } from "@/lib/providers/bfl"

import { bflCost } from "@/lib/costs/pricing"

import { DEFAULT_IMAGE_FORMAT, FLUX_SIZES } from "./formats"
import { withProductReference, type ImageGenerationInput, type ImageGenerationResult, type ImageProvider } from "./types"

// JPEG: every downstream video provider reads it (Kling accepts only JPEG/PNG).
const OUTPUT_FORMAT = "jpeg"
/** Tries per image when BFL's filter refuses the result (the second is a new seed). */
const MODERATION_ATTEMPTS = 1
/** FLUX.2 [pro]/[flex] accept up to eight via the API. */
const MAX_REFERENCES = 8

/** `input_image`, `input_image_2`, … as the FLUX.2 API names them. */
export function referenceFields(references: string[]): Record<string, string> {
  return Object.fromEntries(references.map((url, index) => [index === 0 ? "input_image" : `input_image_${index + 1}`, url]))
}

export type FluxImageProviderOptions = {
  apiKey: string
  model?: string
  fetch?: typeof fetch
  baseUrl?: string
  deadlineMs?: number
  now?: () => number
}

export class FluxImageProvider implements ImageProvider {
  private readonly client: BflClient
  private readonly model: string
  private readonly fetchImpl: typeof fetch

  constructor(options: FluxImageProviderOptions) {
    if (!options.apiKey) throw new Error("BFL_API_KEY is required")
    this.model = options.model ?? "flux-2-pro"
    this.fetchImpl = options.fetch ?? fetch
    this.client = new BflClient({
      apiKey: options.apiKey,
      fetch: this.fetchImpl,
      baseUrl: options.baseUrl,
      deadlineMs: options.deadlineMs,
      now: options.now,
    })
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    // Only FLUX.2 models take reference images (`input_image` … `input_image_8`);
    // older FLUX models would reject or ignore them, so they stay text-only.
    const references = this.model.startsWith("flux-2") ? (input.referenceImages ?? []).slice(0, MAX_REFERENCES) : []
    const { width, height } = FLUX_SIZES[input.format ?? DEFAULT_IMAGE_FORMAT]
    const body = {
      prompt: withProductReference(input.prompt, references.length, "neutral"),
      width,
      height,
      output_format: OUTPUT_FORMAT,
      ...referenceFields(references),
    }

    // BFL's filter also judges the generated picture, so the same request can be
    // refused once and pass the next time (a new random seed). One automatic retry
    // on moderation; every submission is billed, so the charges add up and are
    // reported either way.
    let charged = 0
    for (let attempt = 1; ; attempt += 1) {
      const submission = await this.client.submit(this.model, body)
      charged += bflCost(submission.cost)?.usd ?? 0
      try {
        const ready = await this.client.poll(submission.pollingUrl)
        const { bytes, contentType } = await this.download(ready.sample)
        return {
          bytes,
          contentType,
          provider: "bfl",
          model: this.model,
          providerAssetId: submission.id,
          width,
          height,
          cost: charged > 0 ? { usd: Math.round(charged * 10_000) / 10_000, source: "provider" } : null,
        }
      } catch (error) {
        const moderated = error instanceof BflProviderError && error.code === "PROVIDER_MODERATED"
        if (moderated && attempt < MODERATION_ATTEMPTS) continue
        if (error instanceof Error && charged > 0) Object.assign(error, { costUsd: Math.round(charged * 10_000) / 10_000 })
        throw error
      }
    }
  }

  /**
   * Fetch the signed sample URL WITHOUT forwarding the API key. The signed URL
   * already grants time-limited access; sending `x-key` to a third-party CDN
   * would needlessly expose the provider credential.
   */
  private async download(sampleUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    let response: Response
    try {
      response = await this.fetchImpl(sampleUrl, { method: "GET" })
    } catch {
      throw new BflProviderError("PROVIDER_DOWNLOAD_FAILED")
    }
    if (!response.ok) throw new BflProviderError("PROVIDER_DOWNLOAD_FAILED", response.status)
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.startsWith("image/")) throw new BflProviderError("PROVIDER_DOWNLOAD_FAILED", response.status)
    const buffer = await response.arrayBuffer()
    return { bytes: new Uint8Array(buffer), contentType }
  }
}
