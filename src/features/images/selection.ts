import { z } from "zod"

import { getPrisma } from "@/lib/db/prisma"
import { HttpError } from "@/lib/http/http-error"

export type ImageSelectionRow = { imageId: string; position: number }

type SelectionRepository = {
  findQualifyingImages(projectId: string, imageIds: string[], userId: string): Promise<{ id: string }[]>
  replaceSelection(
    projectId: string,
    rows: ImageSelectionRow[],
    compatibilityImageId: string,
  ): Promise<ImageSelectionRow[]>
}

const imageIdsSchema = z.array(z.string().cuid()).min(1).max(10)

export async function replaceImageSelection(
  projectId: string,
  imageIds: string[],
  userId: string,
  repository: SelectionRepository = prismaSelectionRepository,
): Promise<ImageSelectionRow[]> {
  const parsed = imageIdsSchema.safeParse(imageIds)
  if (!parsed.success) throw new HttpError(400, "Select between 1 and 10 images.")
  const requested = parsed.data
  if (new Set(requested).size !== requested.length) throw new HttpError(400, "Remove duplicate images.")

  const qualifying = await repository.findQualifyingImages(projectId, requested, userId)
  const qualifyingIds = new Set(qualifying.map((image) => image.id))
  const matchesExactly = qualifyingIds.size === requested.length && requested.every((id) => qualifyingIds.has(id))
  if (!matchesExactly) throw new HttpError(404, "Completed images not found.")

  const rows: ImageSelectionRow[] = requested.map((imageId, index) => ({ imageId, position: index + 1 }))
  return repository.replaceSelection(projectId, rows, rows[0].imageId)
}

const prismaSelectionRepository: SelectionRepository = {
  findQualifyingImages(projectId, imageIds, userId) {
    return getPrisma().generatedImage.findMany({
      where: { id: { in: imageIds }, projectId, status: "COMPLETED", project: { userId } },
      select: { id: true },
    })
  },
  async replaceSelection(projectId, rows, compatibilityImageId) {
    const db = getPrisma()
    return db.$transaction(async (transaction) => {
      await transaction.imageSelection.deleteMany({ where: { projectId } })
      await transaction.imageSelection.createMany({
        data: rows.map((row) => ({ projectId, imageId: row.imageId, position: row.position })),
      })
      await transaction.project.update({ where: { id: projectId }, data: { selectedImageId: compatibilityImageId } })
      return rows
    })
  },
}
