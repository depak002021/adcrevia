import { describe, expect, it, vi, beforeEach } from "vitest"

import { PUT as putSelection } from "./route"
import { HttpError } from "@/lib/http/http-error"

const requireUser = vi.fn()
const replaceImageSelection = vi.fn()

vi.mock("@/lib/auth/guards", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}))

vi.mock("@/features/images/selection", () => ({
  replaceImageSelection: (...args: unknown[]) => replaceImageSelection(...args),
}))

const user = { id: "user_1", role: "USER" as const, active: true }

// The route schema validates `imageIds` as CUIDs, so acceptance uses
// CUID-shaped identifiers while preserving the brief's non-default order.
const projectId = "cjld2cjxh0000qzrmn831i7rn"
const imageThree = "cjld2cyuq0000t3rmniod1foy"
const imageOne = "cjld2cyuq0001t3rmniod1abc"

function request(body: unknown) {
  return new Request("http://app/api/projects/project_1/image-selection", {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

function context(id: string) {
  return { params: Promise.resolve({ projectId: id }) } as never
}

describe("PUT /api/projects/[projectId]/image-selection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue(user)
  })

  it("returns 200 with ordered selections for owned, completed images", async () => {
    replaceImageSelection.mockResolvedValue([
      { imageId: imageThree, position: 1 },
      { imageId: imageOne, position: 2 },
    ])

    const response = await putSelection(request({ imageIds: [imageThree, imageOne] }), context(projectId))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      selections: [
        { imageId: imageThree, position: 1 },
        { imageId: imageOne, position: 2 },
      ],
    })
    expect(replaceImageSelection).toHaveBeenCalledWith(projectId, [imageThree, imageOne], user.id)
  })

  it("returns 404 when ownership or image status does not match", async () => {
    replaceImageSelection.mockRejectedValue(new HttpError(404, "Completed images not found."))

    const response = await putSelection(request({ imageIds: [imageThree, imageOne] }), context(projectId))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Completed images not found." })
  })
})
