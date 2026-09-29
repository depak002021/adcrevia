import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getPrisma } from "@/lib/db/prisma"
import type { DecisionAnswer, DecisionProvider } from "@/lib/decisions/types"
import { createDirections } from "./service"

// The distinctness check writes an audit row. Mocked so these stay unit tests and
// never reach for a database connection.
vi.mock("@/lib/db/prisma", () => ({ getPrisma: vi.fn() }))

beforeEach(() => {
  vi.mocked(getPrisma).mockReturnValue({
    decision: { createMany: vi.fn(async () => ({ count: 1 })) },
  } as unknown as ReturnType<typeof getPrisma>)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function directionFixtures(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    title: `Direction ${index + 1}`,
    description: `A commercially focused campaign direction number ${index + 1}.`,
    environment: `Environment ${index + 1}`,
    lighting: `Lighting ${index + 1}`,
    composition: `Composition ${index + 1}`,
    cameraDirection: `Camera ${index + 1}`,
    mood: `Mood ${index + 1}`,
    colorTreatment: `Color treatment ${index + 1}`,
    imagePrompt: `A detailed premium product campaign prompt for creative direction number ${index + 1}.`,
  }))
}

const context = {
  projectId: "project_1",
  productPrompt: "A sculptural perfume bottle in a nocturnal gallery",
  enhancedPrompt: null,
  website: null,
  palette: ["#0A0A0A", "#7656FF"],
}

/** Answers the distinctness question with a fixed probability and confidence. */
function distinctnessProvider(probability: number, confidence: number): DecisionProvider {
  return {
    name: "stub",
    evaluate: vi.fn(async () => ({
      answers: {
        directions_are_distinct: {
          type: "noul",
          noul: probability,
          yes: probability >= 0.5,
          confidence,
          providerConfidence: null,
        } satisfies DecisionAnswer,
      },
      model: "stub-1",
      latencyMs: 25,
      inputTokens: 200,
      outputTokens: 12,
    })),
  }
}

/** A provider that is down, for the availability cases. */
function unavailableProvider(): DecisionProvider {
  return {
    name: "stub",
    evaluate: vi.fn(async () => {
      throw new Error("backend unreachable")
    }),
  }
}

type SavedDirection = ReturnType<typeof directionFixtures>[number] & { position: number }

function call(options: {
  count: number
  targetImageCount?: number
  directions?: ReturnType<typeof directionFixtures>
  decisionProvider?: DecisionProvider
}) {
  const directions = options.directions ?? directionFixtures(options.count)
  const replaceDirections = vi.fn(async (_projectId: string, saved: SavedDirection[]) => saved)
  return {
    replaceDirections,
    result: createDirections("project_1", "user_1", {
      provider: { createDirections: vi.fn().mockResolvedValue(directions) },
      repository: {
        getOwnedContext: vi
          .fn()
          .mockResolvedValue({ context, targetImageCount: options.targetImageCount ?? options.count }),
        replaceDirections,
      },
      decisionProvider: options.decisionProvider ?? distinctnessProvider(0.95, 0.9),
    }),
  }
}

describe("createDirections", () => {
  it("keeps shots that already have a finished image and re-plans only the rest", async () => {
    const replaceDirections = vi.fn(async (_projectId: string, saved: SavedDirection[]) => saved)
    const createDirectionsMock = vi.fn().mockResolvedValue(directionFixtures(3))
    const directions = await createDirections("project_1", "user_1", {
      provider: { createDirections: createDirectionsMock },
      repository: {
        getOwnedContext: vi.fn().mockResolvedValue({ context, targetImageCount: 4, kept: [{ id: "kept_2", position: 2, title: "Finished shot" }] }),
        replaceDirections,
      },
      decisionProvider: distinctnessProvider(0.95, 0.9),
    })

    expect(createDirectionsMock).toHaveBeenCalledWith(expect.objectContaining({ existingShots: ["Finished shot"] }), 3)
    expect(directions.map((direction) => direction.position)).toEqual([1, 3, 4])
    expect(replaceDirections).toHaveBeenCalledWith("project_1", expect.any(Array), ["kept_2"])
  })

  it.each([1, 7, 10])("persists exactly %i distinct structured directions", async (targetImageCount) => {
    const { result, replaceDirections } = call({ count: targetImageCount })
    const directions = await result

    expect(directions).toHaveLength(targetImageCount)
    expect(new Set(directions.map((item) => item.title)).size).toBe(targetImageCount)
    expect(directions.map((item) => item.position)).toEqual(
      Array.from({ length: targetImageCount }, (_, index) => index + 1),
    )
    expect(replaceDirections).toHaveBeenCalledOnce()
  })

  it("rejects a provider response with one fewer direction than the project snapshot", async () => {
    await expect(call({ count: 6, targetImageCount: 7 }).result).rejects.toThrow()
  })

  it("rejects duplicate direction titles without consulting a classifier", async () => {
    const directions = directionFixtures(7)
    directions[6].title = directions[0].title
    const decisionProvider = distinctnessProvider(0.95, 0.9)

    await expect(call({ count: 7, directions, decisionProvider }).result).rejects.toThrow(
      "DIRECTIONS_MUST_BE_DISTINCT",
    )
    // Two directions with the same name are the same direction whatever else they
    // say, so this case is settled for free.
    expect(decisionProvider.evaluate).not.toHaveBeenCalled()
  })

  it("rejects directions the classifier is confident are the same shoot", async () => {
    // The title check cannot catch this: four differently named directions all
    // describing the same softly lit studio table pass it every time.
    const { result, replaceDirections } = call({
      count: 4,
      decisionProvider: distinctnessProvider(0.05, 0.9),
    })
    await expect(result).rejects.toThrow("DIRECTIONS_MUST_BE_DISTINCT")
    expect(replaceDirections).not.toHaveBeenCalled()
  })

  it("lets directions through when the classifier is unsure", async () => {
    // Regenerating costs another model call and the user's patience, so only a
    // confident negative rejects.
    const directions = await call({ count: 4, decisionProvider: distinctnessProvider(0.4, 0.02) }).result
    expect(directions).toHaveLength(4)
  })

  it("does not block a generation when the decision backend is down", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const directions = await call({ count: 4, decisionProvider: unavailableProvider() }).result

    expect(directions).toHaveLength(4)
    expect(consoleError).toHaveBeenCalledWith("[directions] distinctness check unavailable", expect.anything())
  })

  it("skips the check for a single direction, which cannot differ from itself", async () => {
    const decisionProvider = distinctnessProvider(0.05, 0.9)
    const directions = await call({ count: 1, decisionProvider }).result

    expect(directions).toHaveLength(1)
    expect(decisionProvider.evaluate).not.toHaveBeenCalled()
  })

  it("shows the classifier the shoot attributes rather than just the titles", async () => {
    const decisionProvider = distinctnessProvider(0.95, 0.9)
    await call({ count: 3, decisionProvider }).result

    const state = vi.mocked(decisionProvider.evaluate).mock.calls[0][0].state as {
      directions: Array<Record<string, unknown>>
    }
    expect(state.directions).toHaveLength(3)
    expect(Object.keys(state.directions[0])).toEqual([
      "title",
      "environment",
      "lighting",
      "composition",
      "cameraDirection",
      "mood",
      "colorTreatment",
    ])
    // `imagePrompt` is deliberately absent: it repeats every other field and would
    // dominate the state for no extra signal.
    expect(state.directions[0]).not.toHaveProperty("imagePrompt")
  })
})
