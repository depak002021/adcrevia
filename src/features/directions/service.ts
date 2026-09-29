import type { CreativeDirectionInput } from "./schemas"
import { creativeDirectionsResponseSchema } from "./schemas"
import type { PromptContext, TextIntelligenceProvider } from "@/lib/ai/text-provider"
import { getPrisma } from "@/lib/db/prisma"
import { directionsAreDistinct, resolveGate } from "@/lib/decisions/questions"
import { decide } from "@/lib/decisions/service"
import type { DecisionProvider } from "@/lib/decisions/types"
import { HttpError } from "@/lib/http/http-error"
import { createOpenAITextProvider } from "@/lib/providers/runtime"

type PositionedDirection = CreativeDirectionInput & { position: number }
type OwnedDirectionContext = {
  context: PromptContext
  targetImageCount: number
  /** Shots that already have a finished image: kept, never re-planned or deleted. */
  kept?: Array<{ id: string; position: number; title: string }>
}

type DirectionRepository = {
  getOwnedContext(projectId: string, userId: string): Promise<OwnedDirectionContext | null>
  replaceDirections(projectId: string, directions: PositionedDirection[], keepIds?: string[]): Promise<PositionedDirection[]>
}

export async function createDirections(
  projectId: string,
  userId: string,
  dependencies?: {
    provider: Pick<TextIntelligenceProvider, "createDirections">
    repository: DirectionRepository
    /** Injected in tests, or to pin a decision backend for one call. */
    decisionProvider?: DecisionProvider
  },
) {
  const repository = dependencies?.repository ?? directionRepository
  const provider = dependencies?.provider ?? await createOpenAITextProvider()
  const owned = await repository.getOwnedContext(projectId, userId)
  if (!owned) throw new HttpError(404, "Project not found")
  const { context, targetImageCount } = owned
  // Refreshing the shot list after some shots are made re-plans only the rest: a
  // finished (paid-for) image is never deleted by a change of direction, which is
  // what used to happen when the conversation refreshed the directions.
  const kept = owned.kept ?? []
  const count = targetImageCount - kept.length
  if (count <= 0) throw new Error("ALL_SHOTS_MADE")
  const planning: PromptContext = kept.length ? { ...context, existingShots: kept.map((shot) => shot.title) } : context
  const parsed = creativeDirectionsResponseSchema(count).parse({ directions: await provider.createDirections(planning, count) }).directions

  // Duplicate titles are the cheap, certain case: two directions with the same name
  // are the same direction whatever else they say, and catching it here costs nothing.
  const titles = new Set([...parsed.map((direction) => direction.title), ...kept.map((shot) => shot.title)].map((title) => title.trim().toLocaleLowerCase()))
  if (titles.size !== count + kept.length) throw new Error("DIRECTIONS_MUST_BE_DISTINCT")

  await assertDirectionsAreDistinct(projectId, parsed, dependencies?.decisionProvider)

  const taken = new Set(kept.map((shot) => shot.position))
  const free = Array.from({ length: targetImageCount }, (_, index) => index + 1).filter((position) => !taken.has(position))
  const positioned = parsed.map((direction, index) => ({ ...direction, position: free[index] }))
  return repository.replaceDirections(projectId, positioned, kept.map((shot) => shot.id))
}

/**
 * Check that the directions are actually different shoots.
 *
 * The title check above was the whole of this test, which is why the product could
 * return four directions called different things that all described the same softly
 * lit studio table. A set of distinct strings is not a set of distinct photographs.
 *
 * Only a CONFIDENT negative rejects. The classifier is advisory here: regenerating
 * costs another model call and a user's patience, so an unsure answer lets the
 * directions through rather than trapping somebody in a retry loop. A single
 * direction is exempt, since nothing can be distinct from itself.
 */
async function assertDirectionsAreDistinct(
  projectId: string,
  directions: CreativeDirectionInput[],
  decisionProvider?: DecisionProvider,
) {
  if (directions.length < 2) return

  try {
    const result = await decide({
      questions: { directions_are_distinct: directionsAreDistinct },
      state: {
        directions: directions.map(({ title, environment, lighting, composition, cameraDirection, mood, colorTreatment }) => ({
          title,
          environment,
          lighting,
          composition,
          cameraDirection,
          mood,
          colorTreatment,
        })),
      },
      projectId,
      provider: decisionProvider,
    })

    if (resolveGate("directions_are_distinct", result.answers.directions_are_distinct) === false) {
      throw new Error("DIRECTIONS_MUST_BE_DISTINCT")
    }
  } catch (error) {
    // A backend that is down or rate limited must not block a generation. The
    // deterministic title check has already run, and this is the advisory half.
    if (error instanceof Error && error.message === "DIRECTIONS_MUST_BE_DISTINCT") throw error
    console.error("[directions] distinctness check unavailable", {
      projectId,
      reason: error instanceof Error ? error.name : "unknown",
    })
  }
}

export async function enhancePrompt(projectId: string, userId: string, provider?: TextIntelligenceProvider) {
  const owned = await directionRepository.getOwnedContext(projectId, userId)
  if (!owned) throw new HttpError(404, "Project not found")
  const resolvedProvider = provider ?? await createOpenAITextProvider()
  const enhanced = await resolvedProvider.enhancePrompt(owned.context)
  await getPrisma().prompt.update({ where: { projectId }, data: { enhanced } })
  return enhanced
}

export async function suggestPalette(projectId: string, userId: string, provider?: TextIntelligenceProvider) {
  const owned = await directionRepository.getOwnedContext(projectId, userId)
  if (!owned) throw new HttpError(404, "Project not found")
  const resolvedProvider = provider ?? await createOpenAITextProvider()
  const colors = await resolvedProvider.suggestPalette(owned.context)
  await getPrisma().brandPalette.upsert({
    where: { projectId },
    create: { projectId, colors, derived: true },
    update: { colors, derived: true },
  })
  return colors
}

const directionRepository: DirectionRepository = {
  async getOwnedContext(projectId, userId) {
    const project = await getPrisma().project.findFirst({
      where: { id: projectId, userId },
      include: {
        prompt: true,
        websiteReference: true,
        brandPalette: true,
        directions: { select: { id: true, position: true, title: true, image: { select: { status: true } } } },
      },
    })
    if (!project?.prompt) return null
    return {
      targetImageCount: project.targetImageCount,
      kept: project.directions
        .filter((direction) => direction.image?.status === "COMPLETED")
        .map(({ id, position, title }) => ({ id, position, title })),
      context: {
        projectId,
        productPrompt: project.prompt.original,
        enhancedPrompt: project.prompt.enhanced,
        website: project.websiteReference
          ? { url: project.websiteReference.url, analysis: project.websiteReference.analysis }
          : null,
        palette: Array.isArray(project.brandPalette?.colors)
          ? project.brandPalette.colors.filter((color): color is string => typeof color === "string")
          : [],
      },
    }
  },
  async replaceDirections(projectId, directions, keepIds = []) {
    const db = getPrisma()
    return db.$transaction(async (transaction) => {
      await transaction.creativeDirection.deleteMany({ where: { projectId, id: { notIn: keepIds } } })
      return Promise.all(directions.map((direction) => transaction.creativeDirection.create({
        data: {
          projectId,
          position: direction.position,
          title: direction.title,
          description: direction.description,
          environment: direction.environment,
          lighting: direction.lighting,
          composition: direction.composition,
          camera: direction.cameraDirection,
          mood: direction.mood,
          colorTreatment: direction.colorTreatment,
          imagePrompt: direction.imagePrompt,
        },
      }).then(() => direction)))
    })
  },
}
