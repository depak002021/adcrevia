import { describe, expect, it, vi } from "vitest"

import { projectInputSchema } from "./schemas"
import { createProjectDraft } from "./service"

describe("project intake", () => {
  it("normalizes a validated palette", () => {
    expect(
      projectInputSchema.parse({ prompt: "Luxury watch photographed in a night gallery", brandPalette: ["#fff", "#c9a227"] }).brandPalette,
    ).toEqual(["#FFFFFF", "#C9A227"])
  })

  it("persists an owned draft with optional brand context", async () => {
    const create = vi.fn().mockResolvedValue({ id: "project_1", status: "DRAFT" })
    await createProjectDraft(
      {
        prompt: "Luxury watch photographed in a night gallery",
        websiteUrl: "https://example.com",
        brandPalette: ["#0a0a0a", "#fff"],
      },
      "user_1",
      { project: { create } },
      async () => 4,
    )

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        status: "DRAFT",
        targetImageCount: 4,
        prompt: { create: { original: "Luxury watch photographed in a night gallery" } },
        websiteReference: { create: { url: "https://example.com/" } },
        brandPalette: { create: { colors: ["#0A0A0A", "#FFFFFF"], derived: false } },
      }),
      include: expect.objectContaining({ prompt: true }),
    })
  })

  it("snapshots the current image-count policy when each project is created", async () => {
    const stored: Array<Record<string, unknown>> = []
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      stored.push(structuredClone(data))
      return { id: `project_${stored.length}`, ...data }
    })
    let policyCount = 7
    const readPolicy = vi.fn(async () => policyCount)
    const raw = { prompt: "Luxury watch photographed in a night gallery", brandPalette: [] }

    await createProjectDraft(raw, "user_1", { project: { create } }, readPolicy)
    expect(stored[0]?.targetImageCount).toBe(7)

    policyCount = 3
    await createProjectDraft(raw, "user_1", { project: { create } }, readPolicy)

    expect(stored[1]?.targetImageCount).toBe(3)
    expect(stored[0]?.targetImageCount).toBe(7)
  })
})
