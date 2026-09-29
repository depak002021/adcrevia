import OpenAI from "openai"
import { zodTextFormat } from "openai/helpers/zod"
import { z } from "zod"

import { creativeDirectionsResponseSchema } from "@/features/directions/schemas"
import { renderPrompt, resolvePrompt } from "@/lib/prompts/templates"
import { reasoningFor } from "./reasoning"
import { socialCopyResponse, type SocialCopyBody } from "@/features/captions/schema"
import {
  CAPTION_INSTRUCTIONS,
  DIRECTIONS_INSTRUCTIONS,
  ENHANCE_INSTRUCTIONS,
  EVALUATION_INSTRUCTIONS,
  PALETTE_INSTRUCTIONS,
  PROMPT_KEYS,
} from "./instructions"
import type { ImageEvaluationInput, PromptContext, TextIntelligenceProvider } from "./text-provider"

const enhancementResponse = z.object({ enhancedPrompt: z.string().min(30).max(4000) })
const paletteResponse = z.object({ colors: z.array(z.string().regex(/^#[0-9A-F]{6}$/)).min(3).max(8) })

/**
 * The six axes are required, not optional.
 *
 * An optional field here is what let them stay null for the whole life of the
 * product: the rubric already asked for these six things in prose, and nothing ever
 * read them back out. Making them part of the schema is what turns the rubric into
 * data.
 */
const axesResponse = z.object({
  promptAlignment: z.number().min(0).max(100),
  productConsistency: z.number().min(0).max(100),
  brandAlignment: z.number().min(0).max(100),
  composition: z.number().min(0).max(100),
  visualQuality: z.number().min(0).max(100),
  commercialSuitability: z.number().min(0).max(100),
})

const evaluationResponse = z.object({
  evaluations: z.array(z.object({
    imageId: z.string(),
    score: z.number().min(0).max(100),
    strengths: z.array(z.string()).min(1).max(6),
    reasoning: z.string().min(20).max(1000),
    axes: axesResponse,
  })),
})

/**
 * Resolve an instruction, preferring an administrator's active template.
 *
 * Injected so a test can pin the wording, and so a caller that already knows which
 * template it is using does not resolve it twice. A lookup failure falls back to the
 * built-in default rather than taking the request down with it.
 */
export type InstructionResolver = (key: string, fallback: string) => Promise<string>

const defaultResolver: InstructionResolver = async (key, fallback) => (await resolvePrompt(key, fallback)).body

export class OpenAITextProvider implements TextIntelligenceProvider {
  private readonly client: OpenAI
  private readonly model: string
  private readonly instructions: InstructionResolver

  constructor(
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_TEXT_MODEL ?? "gpt-5-mini",
    instructions: InstructionResolver = defaultResolver,
  ) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is required")
    this.client = new OpenAI({ apiKey })
    this.model = model
    this.instructions = instructions
  }

  async enhancePrompt(input: PromptContext) {
    const result = await this.client.responses.parse({
      model: this.model,
      ...reasoningFor(this.model, "low"),
      instructions: await this.instructions(PROMPT_KEYS.enhance, ENHANCE_INSTRUCTIONS),
      input: JSON.stringify(input),
      text: { format: zodTextFormat(enhancementResponse, "enhanced_product_prompt") },
    })
    if (!result.output_parsed) throw new Error("OPENAI_STRUCTURED_OUTPUT_REQUIRED")
    return result.output_parsed.enhancedPrompt
  }

  async suggestPalette(input: PromptContext) {
    const result = await this.client.responses.parse({
      model: this.model,
      ...reasoningFor(this.model, "low"),
      instructions: await this.instructions(PROMPT_KEYS.palette, PALETTE_INSTRUCTIONS),
      input: JSON.stringify(input),
      text: { format: zodTextFormat(paletteResponse, "campaign_palette") },
    })
    if (!result.output_parsed) throw new Error("OPENAI_STRUCTURED_OUTPUT_REQUIRED")
    return result.output_parsed.colors
  }

  async createDirections(input: PromptContext, count: number) {
    // `{{count}}` is substituted rather than concatenated, so an administrator's
    // rewording cannot accidentally drop the number and ask for "several" directions
    // while the schema still demands exactly `count` of them.
    const body = await this.instructions(PROMPT_KEYS.directions, DIRECTIONS_INSTRUCTIONS)
    const result = await this.client.responses.parse({
      model: this.model,
      ...reasoningFor(this.model, "low"),
      instructions: renderPrompt(body, { count: String(count) }),
      input: JSON.stringify(input),
      text: { format: zodTextFormat(creativeDirectionsResponseSchema(count), "adcrevia_creative_directions") },
    })
    if (!result.output_parsed) throw new Error("OPENAI_STRUCTURED_OUTPUT_REQUIRED")
    return result.output_parsed.directions
  }

  /** Social captions, with the token usage so the call's cost is recorded. */
  async writeSocialCopy(input: unknown): Promise<{ copy: SocialCopyBody; model: string; usage: { input: number | null; output: number | null } }> {
    const result = await this.client.responses.parse({
      model: this.model,
      ...reasoningFor(this.model, "low"),
      instructions: await this.instructions(PROMPT_KEYS.captions, CAPTION_INSTRUCTIONS),
      input: JSON.stringify(input),
      text: { format: zodTextFormat(socialCopyResponse, "social_captions") },
    })
    if (!result.output_parsed) throw new Error("OPENAI_STRUCTURED_OUTPUT_REQUIRED")
    return {
      copy: result.output_parsed,
      model: this.model,
      ...reasoningFor(this.model, "low"),
      usage: { input: result.usage?.input_tokens ?? null, output: result.usage?.output_tokens ?? null },
    }
  }

  async evaluateImages(input: ImageEvaluationInput) {
    const result = await this.client.responses.parse({
      model: this.model,
      ...reasoningFor(this.model, "low"),
      instructions: await this.instructions(PROMPT_KEYS.evaluation, EVALUATION_INSTRUCTIONS),
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: JSON.stringify({ projectPrompt: input.projectPrompt, images: input.images.map(({ id, directionTitle }) => ({ id, directionTitle })) }) },
          ...input.images.map((image) => ({ type: "input_image" as const, image_url: image.url, detail: "high" as const })),
        ],
      }],
      text: { format: zodTextFormat(evaluationResponse, "campaign_image_evaluations") },
    })
    if (!result.output_parsed) throw new Error("OPENAI_STRUCTURED_OUTPUT_REQUIRED")
    return result.output_parsed.evaluations
  }
}
