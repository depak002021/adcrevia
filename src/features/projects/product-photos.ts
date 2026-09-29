import { createHash } from "node:crypto"

import { Prisma } from "@/generated/prisma/client"
import { getPrisma } from "@/lib/db/prisma"
import { HttpError } from "@/lib/http/http-error"
import { createStorageProvider } from "@/lib/storage/runtime"
import { ensureUniversalImage } from "@/lib/video/image-format"

import { MAX_PRODUCT_PHOTOS, productPhotosFrom } from "./references"

/**
 * Product photos uploaded by the user.
 *
 * The dependable path when a product page cannot be read (Amazon and other stores
 * block automated reading) and the best one when the seller has their own shots.
 * Stored as JPEG next to the photos copied from the page, and sent to every image and
 * video model exactly the same way.
 */

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"])
const MAX_BYTES = 12 * 1024 * 1024
const MIN_BYTES = 8 * 1024

export type ProductPhotos = { uploaded: string[]; fromWebsite: string[]; max: number }

async function ownedPrompt(projectId: string, userId: string) {
  const prompt = await getPrisma().prompt.findFirst({
    where: { projectId, project: { userId } },
    select: { id: true, productJson: true },
  })
  if (!prompt) throw new HttpError(404, "Project not found")
  return prompt
}

export async function listProductPhotos(projectId: string, userId: string): Promise<ProductPhotos> {
  const prompt = await ownedPrompt(projectId, userId)
  return { ...productPhotosFrom(prompt.productJson), max: MAX_PRODUCT_PHOTOS }
}

export async function addProductPhoto(projectId: string, userId: string, file: File): Promise<ProductPhotos> {
  const prompt = await ownedPrompt(projectId, userId)
  const current = productPhotosFrom(prompt.productJson)
  if (current.uploaded.length >= MAX_PRODUCT_PHOTOS) throw new HttpError(400, `Up to ${MAX_PRODUCT_PHOTOS} photos can be uploaded.`)
  if (!ACCEPTED.has(file.type)) throw new HttpError(400, "Upload a JPEG, PNG, WebP or AVIF photo.")
  if (file.size > MAX_BYTES) throw new HttpError(400, "That photo is larger than 12 MB.")
  if (file.size < MIN_BYTES) throw new HttpError(400, "That image is too small to use as a product photo.")

  const original = new Uint8Array(await file.arrayBuffer())
  const { bytes, contentType } = await ensureUniversalImage(original, file.type).catch(() => {
    throw new HttpError(400, "That photo could not be read. Try a JPEG or PNG.")
  })
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16)
  const key = `projects/${projectId}/references/upload-${digest}.${contentType === "image/png" ? "png" : "jpg"}`
  const stored = await (await createStorageProvider()).put({ key, bytes, contentType })

  await writeUploaded(projectId, (uploaded) => [...new Set([...uploaded, stored.url])].slice(0, MAX_PRODUCT_PHOTOS))
  return listProductPhotos(projectId, userId)
}

export async function removeProductPhoto(projectId: string, userId: string, url: string): Promise<ProductPhotos> {
  await ownedPrompt(projectId, userId)
  await writeUploaded(projectId, (uploaded) => uploaded.filter((item) => item !== url))
  return listProductPhotos(projectId, userId)
}

/** Read-modify-write inside a transaction so two uploads at once cannot drop one. */
async function writeUploaded(projectId: string, change: (uploaded: string[]) => string[]) {
  await getPrisma().$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT 1 FROM "Prompt" WHERE "projectId" = ${projectId} FOR UPDATE`
    const prompt = await transaction.prompt.findUnique({ where: { projectId }, select: { productJson: true } })
    const base =
      prompt?.productJson && typeof prompt.productJson === "object" && !Array.isArray(prompt.productJson)
        ? (prompt.productJson as Record<string, unknown>)
        : { source: "upload" }
    const next = { ...base, uploadedReferences: change(productPhotosFrom(prompt?.productJson).uploaded) }
    await transaction.prompt.update({ where: { projectId }, data: { productJson: next as Prisma.InputJsonValue } })
  })
}
