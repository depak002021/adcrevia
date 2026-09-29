import OpenAI, { toFile } from "openai"

import { openAiImageCost, type OpenAIImageUsage } from "@/lib/costs/pricing"

import { DEFAULT_IMAGE_FORMAT, OPENAI_SIZES } from "./formats"
import { withProductReference, type ImageGenerationInput, type ImageGenerationResult, type ImageProvider } from "./types"

/** gpt-image models accept up to 16 input images on the edit endpoint; we send few. */
const MAX_REFERENCES = 4

type ReferenceFetcher = (url: string) => Promise<{ bytes: Uint8Array; contentType: string }>

export class OpenAIImageProvider implements ImageProvider {
  private readonly client: OpenAI
  private readonly model: string
  private readonly fetchReference: ReferenceFetcher

  constructor(
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5",
    fetchReference: ReferenceFetcher = downloadReference,
  ) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is required")
    this.client = new OpenAI({ apiKey })
    this.model = model
    this.fetchReference = fetchReference
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    // Only gpt-image models take input images (on the edit endpoint); dall-e-3 is text-only.
    const references = this.model.startsWith("gpt-image") ? (input.referenceImages ?? []).slice(0, MAX_REFERENCES) : []
    const size = OPENAI_SIZES[input.format ?? DEFAULT_IMAGE_FORMAT]
    const common = {
      model: this.model,
      prompt: withProductReference(input.prompt, references.length, "neutral"),
      n: 1,
      size,
      quality: "high" as const,
      // JPEG: every downstream video provider reads it (Kling accepts only JPEG/PNG).
      output_format: "jpeg" as const,
    }
    const response = references.length
      ? await this.client.images.edit({
          ...common,
          image: await Promise.all(
            references.map(async (url, index) => {
              const { bytes, contentType } = await this.fetchReference(url)
              return toFile(bytes, `product-${index + 1}.${contentType.split("/")[1] ?? "png"}`, { type: contentType })
            }),
          ),
        })
      : await this.client.images.generate(common)
    const encoded = response.data?.[0]?.b64_json
    if (!encoded) throw new Error("OPENAI_IMAGE_BYTES_REQUIRED")
    const [width, height] = size.split("x").map(Number)
    return {
      bytes: Buffer.from(encoded, "base64"),
      contentType: "image/jpeg",
      provider: "openai",
      model: this.model,
      width,
      height,
      cost: openAiImageCost(this.model, (response as { usage?: OpenAIImageUsage }).usage),
    }
  }
}

/** References are our own stored copies (or data URLs in local storage mode). */
async function downloadReference(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;]+);base64,(.*)$/)
    if (!match) throw new Error("OPENAI_REFERENCE_UNREADABLE")
    return { bytes: Buffer.from(match[2], "base64"), contentType: match[1] }
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error("OPENAI_REFERENCE_UNREADABLE")
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: (response.headers.get("content-type") ?? "image/png").split(";")[0],
  }
}
