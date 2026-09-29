import { z } from "zod"

import { geminiImageCost } from "@/lib/costs/pricing"

import { DEFAULT_IMAGE_FORMAT, FLUX_SIZES } from "./formats"
import { withProductReference, type ImageGenerationInput, type ImageGenerationResult, type ImageProvider } from "./types"

/**
 * Safe, provider-agnostic error codes surfaced by the Google Imagen client.
 * Raw response bodies are never attached so keys or prompt content cannot leak.
 */
export type GoogleImageErrorCode =
  | "PROVIDER_AUTHENTICATION_FAILED"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_MODERATED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED"
  | "PROVIDER_INVALID_RESPONSE"

export class GoogleImageProviderError extends Error {
  readonly code: GoogleImageErrorCode
  readonly status?: number
  constructor(code: GoogleImageErrorCode, status?: number) {
    super(code)
    this.name = "GoogleImageProviderError"
    this.code = code
    this.status = status
  }
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

/** Current default: fast, cheap, and keeps up to 10 reference objects faithful. */
export const DEFAULT_GOOGLE_IMAGE_MODEL = "gemini-3.1-flash-image"

/** Gemini 3 image models accept up to 14 references; a product needs a few. */
const MAX_REFERENCES = 6

// generateContent returns the image as an inlineData part. Validated narrowly.
const partSchema = z.object({
  text: z.string().optional(),
  inlineData: z.object({ mimeType: z.string().optional(), data: z.string().min(1) }).optional(),
})
const responseSchema = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(partSchema).optional() }).optional(), finishReason: z.string().optional() }))
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
      candidatesTokensDetails: z.array(z.object({ modality: z.string().optional(), tokenCount: z.number().optional() })).optional(),
    })
    .optional(),
})

const SAFETY_FINISH = new Set(["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_PROHIBITED_CONTENT"])

export type GoogleImageProviderOptions = {
  apiKey: string
  model?: string
  fetch?: typeof fetch
  baseUrl?: string
}

/**
 * Google image generation with the Gemini image models ("Nano Banana"):
 * gemini-3.1-flash-image, gemini-3-pro-image, gemini-3.1-flash-lite-image.
 *
 * Imagen, which this adapter used to call through `:predict`, is no longer offered
 * to these keys, so a saved `imagen-*` model is mapped to the current default rather
 * than failing a paid run. Product photos go in as inline image parts, which is what
 * lets these models keep the real product's design.
 */
export class GoogleImageProvider implements ImageProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string

  constructor(options: GoogleImageProviderOptions) {
    if (!options.apiKey) throw new Error("GEMINI_API_KEY is required")
    this.apiKey = options.apiKey
    const requested = options.model ?? DEFAULT_GOOGLE_IMAGE_MODEL
    this.model = requested.startsWith("imagen") ? DEFAULT_GOOGLE_IMAGE_MODEL : requested
    this.fetchImpl = options.fetch ?? fetch
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const format = input.format ?? DEFAULT_IMAGE_FORMAT
    const references = await Promise.all(
      (input.referenceImages ?? []).slice(0, MAX_REFERENCES).map((url) => this.inlinePart(url)),
    )
    const response = await this.request(`${this.baseUrl}/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: withProductReference(input.prompt, references.length) }, ...references] }],
        // Lite is offered (and priced) at 1K; the others at 2K.
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: format, imageSize: this.model.includes("lite") ? "1K" : "2K" } },
      }),
    })
    this.assertOk(response)
    const parsed = responseSchema.safeParse(await this.readJson(response))
    if (!parsed.success) throw new GoogleImageProviderError("PROVIDER_INVALID_RESPONSE", response.status)

    if (parsed.data.promptFeedback?.blockReason) throw new GoogleImageProviderError("PROVIDER_MODERATED", response.status)
    const candidate = parsed.data.candidates?.[0]
    const image = candidate?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData
    if (!image) {
      if (candidate?.finishReason && SAFETY_FINISH.has(candidate.finishReason)) {
        throw new GoogleImageProviderError("PROVIDER_MODERATED", response.status)
      }
      throw new GoogleImageProviderError("PROVIDER_INVALID_RESPONSE", response.status)
    }

    return {
      bytes: new Uint8Array(Buffer.from(image.data, "base64")),
      contentType: image.mimeType ?? "image/png",
      provider: "google",
      model: this.model,
      width: FLUX_SIZES[format].width,
      height: FLUX_SIZES[format].height,
      cost: geminiImageCost(this.model, parsed.data.usageMetadata),
    }
  }

  /** Inline image part from a data URL (our stored assets) or, failing that, a fetch. */
  private async inlinePart(url: string) {
    const match = url.match(/^data:([^;]+);base64,(.*)$/)
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } }
    const response = await this.request(url, { method: "GET" })
    if (!response.ok) throw new GoogleImageProviderError("PROVIDER_REJECTED", response.status)
    const mimeType = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0]
    return { inlineData: { mimeType, data: Buffer.from(await response.arrayBuffer()).toString("base64") } }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init)
    } catch {
      throw new GoogleImageProviderError("PROVIDER_UNAVAILABLE")
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      throw new GoogleImageProviderError("PROVIDER_INVALID_RESPONSE", response.status)
    }
  }

  private assertOk(response: Response): void {
    if (response.ok) return
    // Deliberately ignore the body so provider secrets never surface.
    if (response.status === 401 || response.status === 403) throw new GoogleImageProviderError("PROVIDER_AUTHENTICATION_FAILED", response.status)
    if (response.status === 429) throw new GoogleImageProviderError("PROVIDER_RATE_LIMIT", response.status)
    if (response.status >= 500) throw new GoogleImageProviderError("PROVIDER_UNAVAILABLE", response.status)
    throw new GoogleImageProviderError("PROVIDER_REJECTED", response.status)
  }
}
