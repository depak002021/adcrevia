import { z } from "zod"

import type { ImageEvaluationInput, ImageEvaluationResult, TextIntelligenceProvider } from "@/lib/ai/text-provider"
import { getPrisma } from "@/lib/db/prisma"
import { createOpenAITextProvider } from "@/lib/providers/runtime"
import { prepareImageForProvider } from "@/lib/storage/provider-assets"

const axis = z.number().min(0).max(100)

const resultSchema = z.object({
  imageId: z.string(),
  score: z.number().min(0).max(100),
  strengths: z.array(z.string().min(1)).min(1).max(6),
  reasoning: z.string().min(20).max(1000),
  /**
   * Defaulted rather than required, so an evaluation from a provider that does not
   * supply them still lands. The columns stay null in that case, which is the truth;
   * inventing a number from the overall score would make the breakdown look real.
   */
  axes: z
    .object({
      promptAlignment: axis,
      productConsistency: axis,
      brandAlignment: axis,
      composition: axis,
      visualQuality: axis,
      commercialSuitability: axis,
    })
    .optional(),
})

type EvaluationRepository = {
  getEvaluationContext(projectId: string): Promise<ImageEvaluationInput | null>
  saveEvaluations(projectId: string, evaluations: ImageEvaluationResult[]): Promise<unknown>
}

export async function evaluateProjectImages(
  projectId: string,
  dependencies?: {
    provider: Pick<TextIntelligenceProvider, "evaluateImages">
    repository: EvaluationRepository
  },
) {
  const repository = dependencies?.repository ?? prismaEvaluationRepository
  const provider = dependencies?.provider ?? await createOpenAITextProvider()
  const context = await repository.getEvaluationContext(projectId)
  if (!context || context.images.length !== context.targetImageCount) throw new Error("TARGET_COMPLETED_IMAGES_REQUIRED")
  const providerContext = {
    ...context,
    images: await Promise.all(context.images.map(async (image) => ({
      ...image,
      url: await prepareImageForProvider(image.url),
    }))),
  }
  const evaluations = z.array(resultSchema).parse(await provider.evaluateImages(providerContext))
  const expectedIds = new Set(context.images.map((image) => image.id))
  const actualIds = new Set(evaluations.map((evaluation) => evaluation.imageId))
  if (evaluations.length !== context.targetImageCount || actualIds.size !== context.targetImageCount || [...actualIds].some((id) => !expectedIds.has(id))) {
    throw new Error("ONE_EVALUATION_PER_IMAGE_REQUIRED")
  }
  await repository.saveEvaluations(projectId, evaluations)
  const highest = evaluations.reduce((best, current) => current.score > best.score ? current : best)
  return evaluations.map((evaluation) => ({ ...evaluation, recommended: evaluation.imageId === highest.imageId }))
}

const prismaEvaluationRepository: EvaluationRepository = {
  async getEvaluationContext(projectId) {
    const project = await getPrisma().project.findUnique({
      where: { id: projectId },
      select: {
        targetImageCount: true,
        prompt: { select: { original: true, enhanced: true } },
        images: {
          where: { status: "COMPLETED", url: { not: null } },
          orderBy: { position: "asc" },
          select: { id: true, url: true, direction: { select: { title: true } } },
        },
      },
    })
    if (!project?.prompt) return null
    return {
      projectPrompt: project.prompt.enhanced ?? project.prompt.original,
      targetImageCount: project.targetImageCount,
      images: project.images.map((image) => ({ id: image.id, url: image.url!, directionTitle: image.direction.title })),
    }
  },
  async saveEvaluations(_projectId, evaluations) {
    const db = getPrisma()
    return db.$transaction(evaluations.map((evaluation) => {
      // Six columns that have been null since the first migration. Written here for
      // the first time, and left null when the provider genuinely did not score them.
      const axes = {
        promptAlignment: evaluation.axes?.promptAlignment ?? null,
        productConsistency: evaluation.axes?.productConsistency ?? null,
        brandAlignment: evaluation.axes?.brandAlignment ?? null,
        composition: evaluation.axes?.composition ?? null,
        visualQuality: evaluation.axes?.visualQuality ?? null,
        commercialSuitability: evaluation.axes?.commercialSuitability ?? null,
      }
      return db.imageEvaluation.upsert({
        where: { imageId: evaluation.imageId },
        create: {
          imageId: evaluation.imageId,
          score: evaluation.score,
          strengths: evaluation.strengths,
          reasoning: evaluation.reasoning,
          ...axes,
        },
        update: {
          score: evaluation.score,
          strengths: evaluation.strengths,
          reasoning: evaluation.reasoning,
          ...axes,
        },
      })
    }))
  },
}
