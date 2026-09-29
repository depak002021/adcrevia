import { describe, expect, it, vi } from "vitest"

import { replaceImageSelection } from "./selection"

const IMAGE_1 = "ckimage000000000000000001"
const IMAGE_2 = "ckimage000000000000000002"
const IMAGE_3 = "ckimage000000000000000003"

function repositoryReturning(ids: string[]) {
  return {
    findQualifyingImages: vi.fn().mockResolvedValue(ids.map((id) => ({ id }))),
    replaceSelection: vi.fn(async (_projectId: string, rows: { imageId: string; position: number }[]) => rows),
  }
}

describe("replaceImageSelection", () => {
  it("persists a single ordered selection and the compatibility pointer", async () => {
    const repository = repositoryReturning([IMAGE_1])
    const result = await replaceImageSelection("project_1", [IMAGE_1], "user_1", repository)

    expect(result).toEqual([{ imageId: IMAGE_1, position: 1 }])
    expect(repository.replaceSelection).toHaveBeenCalledWith(
      "project_1",
      [{ imageId: IMAGE_1, position: 1 }],
      IMAGE_1,
    )
  })

  it("persists up to ten ordered selections with deterministic positions", async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `ckimage00000000000000000${index}0`)
    const repository = repositoryReturning(ids)
    const result = await replaceImageSelection("project_1", ids, "user_1", repository)

    expect(result).toEqual(ids.map((imageId, index) => ({ imageId, position: index + 1 })))
    expect(repository.replaceSelection).toHaveBeenCalledWith(
      "project_1",
      ids.map((imageId, index) => ({ imageId, position: index + 1 })),
      ids[0],
    )
  })

  it("preserves the requested order when assigning positions and the pointer", async () => {
    // Repository returns rows in a different (unordered) order than requested.
    const repository = {
      findQualifyingImages: vi.fn().mockResolvedValue([{ id: IMAGE_1 }, { id: IMAGE_3 }]),
      replaceSelection: vi.fn(async (_projectId: string, rows: { imageId: string; position: number }[]) => rows),
    }
    await replaceImageSelection("project_1", [IMAGE_3, IMAGE_1], "user_1", repository)

    expect(repository.replaceSelection).toHaveBeenCalledWith(
      "project_1",
      [
        { imageId: IMAGE_3, position: 1 },
        { imageId: IMAGE_1, position: 2 },
      ],
      IMAGE_3,
    )
  })

  it("rejects duplicate image ids", async () => {
    const repository = repositoryReturning([IMAGE_1])
    await expect(
      replaceImageSelection("project_1", [IMAGE_1, IMAGE_1], "user_1", repository),
    ).rejects.toMatchObject({ status: 400 })
    expect(repository.replaceSelection).not.toHaveBeenCalled()
  })

  it("rejects an empty list", async () => {
    const repository = repositoryReturning([])
    await expect(
      replaceImageSelection("project_1", [], "user_1", repository),
    ).rejects.toMatchObject({ status: 400 })
    expect(repository.findQualifyingImages).not.toHaveBeenCalled()
  })

  it("rejects more than ten image ids", async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `ckimage0000000000000000${index}00`)
    const repository = repositoryReturning(ids)
    await expect(
      replaceImageSelection("project_1", ids, "user_1", repository),
    ).rejects.toMatchObject({ status: 400 })
    expect(repository.replaceSelection).not.toHaveBeenCalled()
  })

  it("rejects incomplete or non-existent images (fewer qualifying images returned)", async () => {
    const repository = repositoryReturning([IMAGE_1])
    await expect(
      replaceImageSelection("project_1", [IMAGE_1, IMAGE_2], "user_1", repository),
    ).rejects.toMatchObject({ status: 404 })
    expect(repository.replaceSelection).not.toHaveBeenCalled()
  })

  it("rejects cross-project images (qualifying set does not match requested set)", async () => {
    // Owner-scoped query returns a different image than requested.
    const repository = {
      findQualifyingImages: vi.fn().mockResolvedValue([{ id: IMAGE_1 }]),
      replaceSelection: vi.fn(),
    }
    await expect(
      replaceImageSelection("project_1", [IMAGE_2], "user_1", repository),
    ).rejects.toMatchObject({ status: 404 })
    expect(repository.replaceSelection).not.toHaveBeenCalled()
  })
})
