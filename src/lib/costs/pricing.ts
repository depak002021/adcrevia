/**
 * What a generation costs, in USD. One place for every rate, so the estimate shown
 * before a run, the cost recorded after it and the totals all agree.
 *
 * Actual costs come from what the provider reports whenever it reports something:
 *   FLUX (BFL)  `cost` in credits on every submission; 1 credit = $0.01
 *   OpenAI      token usage on every image response
 *   Gemini      token usage (usageMetadata) on every response
 *   Seedance    billed tokens on the finished task (seedance-models.ts)
 *   Veo, Kling  billed per second of output (clip-models.ts)
 *
 * List prices checked 2026-09-25: docs.bfl.ai/quick_start/pricing,
 * developers.openai.com/api/docs/pricing, ai.google.dev/gemini-api/docs/pricing.
 */

import { FLUX_SIZES, OPENAI_SIZES, type ImageFormat } from "@/lib/providers/images/formats"

export type CostSource = "provider" | "list"
export type Cost = { usd: number; source: CostSource }

export function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

// ---- FLUX (Black Forest Labs) ------------------------------------------------------

export const BFL_USD_PER_CREDIT = 0.01

/** List price per output megapixel, for the estimate only (the actual comes from `cost`). */
const FLUX_USD_PER_MP: Record<string, number> = { "flux-2-pro": 0.03, "flux-2-flex": 0.05, "flux-2-max": 0.07 }

export function bflCost(credits: number | undefined | null): Cost | null {
  return typeof credits === "number" && Number.isFinite(credits) ? { usd: roundUsd(credits * BFL_USD_PER_CREDIT), source: "provider" } : null
}

// ---- OpenAI gpt-image ----------------------------------------------------------------

/** USD per 1M tokens: text input, image input, image output. */
const OPENAI_IMAGE_RATES: Record<string, { text: number; imageIn: number; imageOut: number }> = {
  "gpt-image-2": { text: 5, imageIn: 8, imageOut: 30 },
  "gpt-image-1.5": { text: 5, imageIn: 8, imageOut: 32 },
  "gpt-image-1": { text: 5, imageIn: 10, imageOut: 40 },
  "gpt-image-1-mini": { text: 2, imageIn: 2.5, imageOut: 8 },
}

/** Output tokens for a high-quality image at each size (OpenAI's published counts). */
const OPENAI_HIGH_OUTPUT_TOKENS: Record<string, number> = { "1024x1024": 4160, "1024x1536": 6240, "1536x1024": 6208 }

export type OpenAIImageUsage = {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { text_tokens?: number; image_tokens?: number }
}

function openAiRates(model: string) {
  return OPENAI_IMAGE_RATES[model] ?? OPENAI_IMAGE_RATES[Object.keys(OPENAI_IMAGE_RATES).find((key) => model.startsWith(key)) ?? "gpt-image-1.5"]
}

export function openAiImageCost(model: string, usage: OpenAIImageUsage | undefined | null): Cost | null {
  if (!usage || typeof usage.output_tokens !== "number") return null
  const rates = openAiRates(model)
  const imageIn = usage.input_tokens_details?.image_tokens ?? 0
  const textIn = usage.input_tokens_details?.text_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - imageIn)
  const usd = (textIn * rates.text + imageIn * rates.imageIn + usage.output_tokens * rates.imageOut) / 1_000_000
  return { usd: roundUsd(usd), source: "provider" }
}

// ---- Google Gemini image models --------------------------------------------------------

/** USD per 1M tokens: input (text/image), image output, text/thinking output. */
const GEMINI_IMAGE_RATES: Record<string, { input: number; imageOut: number; textOut: number; listPerImage: number }> = {
  "gemini-3.1-flash-image": { input: 0.5, imageOut: 60, textOut: 3, listPerImage: 0.101 },
  "gemini-3-pro-image": { input: 2, imageOut: 120, textOut: 12, listPerImage: 0.134 },
  "gemini-3.1-flash-lite-image": { input: 0.25, imageOut: 30, textOut: 1.5, listPerImage: 0.034 },
}

export type GeminiUsage = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
  candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>
}

function geminiRates(model: string) {
  return GEMINI_IMAGE_RATES[model] ?? GEMINI_IMAGE_RATES["gemini-3.1-flash-image"]
}

export function geminiImageCost(model: string, usage: GeminiUsage | undefined | null): Cost | null {
  if (!usage || typeof usage.candidatesTokenCount !== "number") return null
  const rates = geminiRates(model)
  const imageOut = (usage.candidatesTokensDetails ?? []).filter((item) => item.modality === "IMAGE").reduce((sum, item) => sum + (item.tokenCount ?? 0), 0)
  const textOut = Math.max(0, usage.candidatesTokenCount - imageOut) + (usage.thoughtsTokenCount ?? 0)
  const usd = ((usage.promptTokenCount ?? 0) * rates.input + imageOut * rates.imageOut + textOut * rates.textOut) / 1_000_000
  return { usd: roundUsd(usd), source: "provider" }
}

// ---- Estimates before a run -----------------------------------------------------------

/**
 * Estimated USD for one image, before it is generated. Output-based list prices; the
 * product photos sent as references add a little on top, which the actual includes.
 */
export function estimateImageUsd(provider: string, model: string, format: ImageFormat): number | null {
  if (provider === "bfl") {
    const rate = FLUX_USD_PER_MP[model]
    if (!rate) return null
    const { width, height } = FLUX_SIZES[format]
    return roundUsd(Math.max(1, (width * height) / 1_000_000) * rate)
  }
  if (provider === "openai") {
    const tokens = OPENAI_HIGH_OUTPUT_TOKENS[OPENAI_SIZES[format]] ?? 6240
    return roundUsd((tokens * openAiRates(model).imageOut) / 1_000_000)
  }
  if (provider === "google") return geminiRates(model).listPerImage
  return null
}

// ---- OpenAI text models (captions and other writing) ----------------------------------

/** USD per 1M tokens: input, output. Unknown models are left unpriced rather than guessed. */
const OPENAI_TEXT_RATES: Record<string, { input: number; output: number }> = {
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5.1": { input: 1.25, output: 10 },
  "gpt-5.2": { input: 1.75, output: 14 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
}

export function openAiTextCost(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const rates = OPENAI_TEXT_RATES[model]
  if (!rates || inputTokens === null || outputTokens === null) return null
  return roundUsd((inputTokens * rates.input + outputTokens * rates.output) / 1_000_000)
}
