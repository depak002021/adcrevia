import type { CreativeDirectionInput } from "@/features/directions/schemas"

export type PromptContext = {
  projectId: string
  productPrompt: string
  enhancedPrompt: string | null
  website: { url: string; analysis: unknown } | null
  palette: string[]
  /** Shots already made; plan only the remaining ones, continuing the same story. */
  existingShots?: string[]
}

export type ImageEvaluationInput = {
  projectPrompt: string
  targetImageCount: number
  images: Array<{ id: string; url: string; directionTitle: string }>
}

/**
 * Per-axis scores for one image, 0-100.
 *
 * `ImageEvaluation` has carried these six columns since the first migration and
 * every one of them has always been null: nothing ever scored an image on anything
 * but a single overall number, so the UI could say "84" and never say why. They come
 * from the evaluation call rather than from the decision layer because judging an
 * image needs a vision model, and the decision backends take text only.
 */
export type ImageEvaluationAxes = {
  promptAlignment: number
  productConsistency: number
  brandAlignment: number
  composition: number
  visualQuality: number
  commercialSuitability: number
}

export type ImageEvaluationResult = {
  imageId: string
  score: number
  strengths: string[]
  reasoning: string
  /**
   * Optional, because a provider that cannot see images cannot score them. The
   * columns are left null in that case rather than derived from the overall score,
   * which would make a breakdown that does not exist look real.
   */
  axes?: ImageEvaluationAxes
}

export interface TextIntelligenceProvider {
  enhancePrompt(input: PromptContext): Promise<string>
  suggestPalette(input: PromptContext): Promise<string[]>
  createDirections(input: PromptContext, count: number): Promise<CreativeDirectionInput[]>
  evaluateImages(input: ImageEvaluationInput): Promise<ImageEvaluationResult[]>
}
