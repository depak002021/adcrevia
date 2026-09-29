import { describe, expect, it, vi } from "vitest"

import { createDraftProject } from "./project-repository"

describe("createDraftProject", () => {
  it("creates a draft owned by the supplied user with its source prompt", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "project_1",
      userId: "user_1",
      name: "Perfume launch",
      status: "DRAFT",
    })

    const project = await createDraftProject(
      {
        userId: "user_1",
        name: "Perfume launch",
        prompt: "Luxury perfume on obsidian",
      },
      { project: { create } },
    )

    expect(project).toMatchObject({
      userId: "user_1",
      status: "DRAFT",
      name: "Perfume launch",
    })
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        name: "Perfume launch",
        prompt: { create: { original: "Luxury perfume on obsidian" } },
      },
      include: { prompt: true },
    })
  })
})
