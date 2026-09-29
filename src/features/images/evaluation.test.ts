import { describe, expect, it, vi } from "vitest"

import { evaluateProjectImages } from "./evaluation"

describe("image evaluation", () => {
  it("marks exactly the highest score as recommended without selecting it", async () => {
    const images = [1, 2, 3].map((position) => ({ id: `image_${position}`, url: `https://cdn.example/${position}.webp`, directionTitle: `Direction ${position}` }))
    const provider = { evaluateImages: vi.fn().mockResolvedValue(images.map((image, index) => ({ imageId: image.id, score: [74, 92, 86][index], strengths: ["Commercial framing"], reasoning: `A detailed assessment for image ${index + 1}.` }))) }
    const saveEvaluations = vi.fn(async (evaluations) => evaluations)

    const result = await evaluateProjectImages("project_1", {
      provider,
      repository: {
        getEvaluationContext: vi.fn().mockResolvedValue({ projectPrompt: "Premium watch campaign", targetImageCount: 3, images }),
        saveEvaluations,
      },
    })

    expect(result.filter((item) => item.recommended)).toHaveLength(1)
    expect(result.find((item) => item.recommended)?.imageId).toBe("image_2")
    expect(provider.evaluateImages).toHaveBeenCalledWith(expect.objectContaining({ targetImageCount: 3 }))
    expect(saveEvaluations).toHaveBeenCalledOnce()
  })

  it("rejects evaluations that omit an image", async () => {
    const images = [1, 2, 3].map((position) => ({ id: `image_${position}`, url: `https://cdn.example/${position}.webp`, directionTitle: `Direction ${position}` }))
    await expect(evaluateProjectImages("project_1", {
      provider: { evaluateImages: vi.fn().mockResolvedValue([
        { imageId: "image_1", score: 80, strengths: ["Strong framing"], reasoning: "A detailed assessment for image one." },
        { imageId: "image_2", score: 75, strengths: ["Good lighting"], reasoning: "A detailed assessment for image two." },
      ]) },
      repository: { getEvaluationContext: vi.fn().mockResolvedValue({ projectPrompt: "Prompt", targetImageCount: 3, images }), saveEvaluations: vi.fn() },
    })).rejects.toThrow("ONE_EVALUATION_PER_IMAGE_REQUIRED")
  })
})

/**
 * The six sub-score columns on `ImageEvaluation` have been null since the first
 * migration: the rubric asked for prompt alignment, product consistency, brand
 * alignment, composition, visual quality and commercial suitability, and none of the
 * six was ever read back out of the answer. The UI could show "84" and never say why.
 */
describe("image evaluation sub-scores", () => {
  const images = [1, 2].map((position) => ({
    id: `image_${position}`,
    url: `https://cdn.example/${position}.webp`,
    directionTitle: `Direction ${position}`,
  }))

  const axes = {
    promptAlignment: 88,
    productConsistency: 94,
    brandAlignment: 71,
    composition: 80,
    visualQuality: 90,
    commercialSuitability: 76,
  }

  function harness(evaluations: unknown[]) {
    const saveEvaluations = vi.fn(async (_projectId: string, saved: unknown) => saved)
    return {
      saveEvaluations,
      run: () =>
        evaluateProjectImages("project_1", {
          provider: { evaluateImages: vi.fn().mockResolvedValue(evaluations) },
          repository: {
            getEvaluationContext: vi
              .fn()
              .mockResolvedValue({ projectPrompt: "Premium watch campaign", targetImageCount: 2, images }),
            saveEvaluations,
          },
        }),
    }
  }

  it("carries every axis through to persistence", async () => {
    const { run, saveEvaluations } = harness(
      images.map((image) => ({
        imageId: image.id,
        score: 84,
        strengths: ["Commercial framing"],
        reasoning: "A detailed assessment of this campaign image.",
        axes,
      })),
    )

    await run()

    const saved = saveEvaluations.mock.calls[0][1] as Array<{ axes?: typeof axes }>
    expect(saved[0].axes).toEqual(axes)
  })

  it("accepts an evaluation with no axes rather than failing the run", async () => {
    // A provider that cannot see images cannot score them, and losing the overall
    // evaluation over a missing breakdown would be the wrong trade.
    const { run } = harness(
      images.map((image) => ({
        imageId: image.id,
        score: 84,
        strengths: ["Commercial framing"],
        reasoning: "A detailed assessment of this campaign image.",
      })),
    )

    const result = await run()
    expect(result).toHaveLength(2)
    expect(result[0].axes).toBeUndefined()
  })

  it("rejects an axis outside the 0-100 scale", async () => {
    const { run } = harness(
      images.map((image) => ({
        imageId: image.id,
        score: 84,
        strengths: ["Commercial framing"],
        reasoning: "A detailed assessment of this campaign image.",
        axes: { ...axes, brandAlignment: 140 },
      })),
    )

    // A score off the scale would be stored and then rendered as a bar past the end
    // of its track, which is how a number nobody validated becomes a visual bug.
    await expect(run()).rejects.toThrow()
  })
})
