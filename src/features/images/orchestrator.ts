import { createHash } from "node:crypto"

import { getPrisma } from "@/lib/db/prisma"
import { HttpError } from "@/lib/http/http-error"
import { recordImageGenerationLog } from "@/features/admin/logs/service"
import { BflProviderError } from "@/lib/providers/bfl"
import { GoogleImageProviderError } from "@/lib/providers/images/google"
import type { ImageGenerationResult, ImageProvider } from "@/lib/providers/images/types"
import { statesAllowedBefore } from "./state-machine"
import { createActiveImageProvider, createImageProviderByName } from "@/lib/providers/runtime"
import { readProjectReferences } from "@/features/projects/references"
import { asImageFormat, DEFAULT_IMAGE_FORMAT, type ImageFormat } from "@/lib/providers/images/formats"
import { imageDimensions } from "@/lib/storage/image-size"
import { createStorageProvider } from "@/lib/storage/runtime"
import type { StorageProvider, StoredAsset } from "@/lib/storage/types"

type Direction = { id: string; position: number; imagePrompt: string }
type OwnedDirections = { targetImageCount: number; directions: Direction[] }
type ClaimedImage = { id: string; projectId: string; position: number; imagePrompt: string; attempts: number }
type Completion = ImageGenerationResult & StoredAsset & { key: string; checksum: string }

export interface ImageRunRepository {
  getOwnedDirections(projectId: string, userId: string): Promise<OwnedDirections | null>
  createPendingImages(projectId: string, directions: Direction[]): Promise<unknown>
  claimNextPendingImage(projectId: string): Promise<ClaimedImage | null>
  completeImage(imageId: string, completion: Completion): Promise<unknown>
  failImage(imageId: string, safeErrorCode: string): Promise<unknown>
  summarize(projectId: string): Promise<unknown>
}

export async function startImageRun(
  projectId: string,
  userId: string,
  dependencies: { repository: ImageRunRepository } = { repository: prismaImageRunRepository },
) {
  const owned = await dependencies.repository.getOwnedDirections(projectId, userId)
  if (!owned) throw new HttpError(404, "Project not found")
  const { targetImageCount, directions } = owned
  if (directions.length !== targetImageCount || directions.some((item, index) => item.position !== index + 1)) {
    throw new Error("TARGET_ORDERED_DIRECTIONS_REQUIRED")
  }
  return dependencies.repository.createPendingImages(projectId, directions)
}

export async function processNextImage(
  projectId: string,
  dependencies?: {
    repository: ImageRunRepository
    provider: ImageProvider
    storage: StorageProvider
    /** Test seam; defaults to the product photos saved with the project. */
    readReferences?: (projectId: string) => Promise<string[]>
    /** Test seam; defaults to the frame shape saved on the project. */
    readFormat?: (projectId: string) => Promise<ImageFormat>
  },
  choice?: { provider: "openai" | "bfl" | "google"; model?: string },
  options: {
    /**
     * Called when this image had to move to another model (FLUX refused it), so the
     * rest of the run can go straight there instead of paying for more refusals.
     */
    onFallback?: (next: { provider: "google"; model: string }) => void
    /** Test seam: the model to use when FLUX refuses a shot. */
    fallbackProvider?: () => Promise<ImageProvider | null>
    /** Test seam for the pause before retrying a rate-limited request. */
    sleep?: (ms: number) => Promise<void>
  } = {},
) {
  const repository = dependencies?.repository ?? prismaImageRunRepository
  const provider = dependencies?.provider
    ?? (choice ? await createImageProviderByName(choice.provider, choice.model) : await createActiveImageProvider())
  const storage = dependencies?.storage ?? (await createStorageProvider())
  const image = await repository.claimNextPendingImage(projectId)
  if (!image) return repository.summarize(projectId)

  const startedAt = Date.now()
  // Read after claiming, so an empty queue costs no extra query. Tests that inject
  // their own dependencies get no references unless they ask for them.
  const readReferences = dependencies ? dependencies.readReferences : readProjectReferences
  const referenceImages = readReferences ? await readReferences(projectId).catch(() => []) : []
  const readFormat = dependencies ? dependencies.readFormat : readProjectFormat
  const format = readFormat ? await readFormat(projectId).catch(() => DEFAULT_IMAGE_FORMAT) : DEFAULT_IMAGE_FORMAT
  const request = {
    projectId,
    imageId: image.id,
    position: image.position,
    prompt: image.imagePrompt,
    referenceImages,
    format,
  }
  const failedLog = (error: unknown, safeErrorCode: string, extra: Record<string, unknown> = {}) =>
    recordImageGenerationLog({
      projectId,
      imageId: image.id,
      status: "FAILED",
      provider: choice?.provider ?? (error instanceof BflProviderError ? "bfl" : "active"),
      model: choice?.model ?? null,
      durationMs: Date.now() - startedAt,
      safeErrorCode,
      // What actually went wrong, so a failure can be diagnosed from the log rather
      // than guessed at. Sanitised on write: key-like values are redacted.
      details: { position: image.position, ...describeError(error), ...extra },
    })

  try {
    let generated: ImageGenerationResult
    try {
      generated = await provider.generateImage(request)
    } catch (error) {
      // One recovery, chosen so that no call is wasted:
      //  - rate limited: the request was not billed; wait briefly and ask once more.
      //  - FLUX refused the shot (its filter, often "Protected Content"): FLUX has
      //    already charged, and the same shot is refused again, so the shot moves to
      //    Nano Banana 2, which has not refused a product shot in our logs.
      // Anything else fails as before and the user decides.
      if (isRateLimit(error)) {
        await (options.sleep ?? sleep)(RATE_LIMIT_PAUSE_MS)
        generated = await provider.generateImage(request)
      } else if (error instanceof BflProviderError && error.code === "PROVIDER_MODERATED") {
        const fallbackFactory = options.fallbackProvider ?? (dependencies ? async () => null : defaultFallbackProvider)
        const fallback = await fallbackFactory().catch(() => null)
        if (!fallback) throw error
        await failedLog(error, "PROVIDER_MODERATED", { fallback: FALLBACK_CHOICE.model })
        generated = await fallback.generateImage(request)
        options.onFallback?.(FALLBACK_CHOICE)
      } else {
        throw error
      }
    }
    const extension = generated.contentType === "image/png" ? "png" : generated.contentType === "image/jpeg" ? "jpg" : "webp"
    const key = `projects/${projectId}/images/${String(image.position).padStart(2, "0")}-${image.id}.${extension}`
    const stored = await storage.put({ key, bytes: generated.bytes, contentType: generated.contentType })
    const checksum = createHash("sha256").update(generated.bytes).digest("hex")
    // Record what was actually produced; providers do not always honour the size asked for.
    const measured = imageDimensions(generated.bytes)
    await repository.completeImage(image.id, { ...generated, ...(measured ?? {}), ...stored, key, checksum })
    await recordImageGenerationLog({
      projectId,
      imageId: image.id,
      status: "SUCCEEDED",
      provider: generated.provider,
      model: generated.model,
      durationMs: Date.now() - startedAt,
      details: {
        position: image.position,
        referenceImages: referenceImages.length,
        format,
        // The provider's own figure (BFL credits, OpenAI/Gemini token usage), in USD.
        costUsd: generated.cost?.usd ?? null,
        costSource: generated.cost?.source ?? null,
      },
    })
  } catch (error) {
    const safeErrorCode = normalizeImageError(error)
    await repository.failImage(image.id, safeErrorCode)
    await failedLog(error, safeErrorCode)
  }
  return repository.summarize(projectId)
}

async function readProjectFormat(projectId: string): Promise<ImageFormat> {
  const project = await getPrisma().project.findUnique({ where: { id: projectId }, select: { imageFormat: true } })
  return asImageFormat(project?.imageFormat)
}

const RATE_LIMIT_PAUSE_MS = 4_000
const FALLBACK_CHOICE = { provider: "google" as const, model: "gemini-3.1-flash-image" }

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isRateLimit(error: unknown): boolean {
  if (error instanceof BflProviderError || error instanceof GoogleImageProviderError) return error.code === "PROVIDER_RATE_LIMIT"
  return Boolean(error && typeof error === "object" && "status" in error && Number((error as { status: unknown }).status) === 429)
}

/** Nano Banana 2, when Google is configured; otherwise no fallback. */
async function defaultFallbackProvider(): Promise<ImageProvider | null> {
  return createImageProviderByName(FALLBACK_CHOICE.provider, FALLBACK_CHOICE.model).catch(() => null)
}

function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorName: typeof error }
  const extra = error as Error & { code?: unknown; status?: unknown; costUsd?: unknown }
  return {
    errorName: error.name,
    // Charged even though it failed (BFL bills at submission), so spend stays true.
    ...(typeof extra.costUsd === "number" ? { costUsd: extra.costUsd, costSource: "provider" } : {}),
    ...(typeof extra.code === "string" ? { errorCode: extra.code } : {}),
    ...(typeof extra.status === "number" ? { httpStatus: extra.status } : {}),
    message: error.message.replace(/\s+/g, " ").slice(0, 300),
  }
}

function normalizeImageError(error: unknown) {
  if (error instanceof BflProviderError) return mapBflErrorCode(error.code)
  if (error instanceof GoogleImageProviderError) return mapGoogleErrorCode(error.code)
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status)
    if (status === 429) return "PROVIDER_RATE_LIMIT"
    if (status >= 500) return "PROVIDER_UNAVAILABLE"
    if (status >= 400) return "PROVIDER_REJECTED"
  }
  return "IMAGE_GENERATION_FAILED"
}

function mapBflErrorCode(code: BflProviderError["code"]): string {
  switch (code) {
    case "PROVIDER_RATE_LIMIT":
      return "PROVIDER_RATE_LIMIT"
    case "PROVIDER_MODERATED":
      return "PROVIDER_MODERATED"
    case "PROVIDER_AUTHENTICATION_FAILED":
    case "PROVIDER_REJECTED":
      return "PROVIDER_REJECTED"
    case "PROVIDER_TIMEOUT":
    case "PROVIDER_UNAVAILABLE":
      return "PROVIDER_UNAVAILABLE"
    default:
      return "IMAGE_GENERATION_FAILED"
  }
}

function mapGoogleErrorCode(code: GoogleImageProviderError["code"]): string {
  switch (code) {
    case "PROVIDER_RATE_LIMIT":
      return "PROVIDER_RATE_LIMIT"
    case "PROVIDER_MODERATED":
      return "PROVIDER_MODERATED"
    case "PROVIDER_AUTHENTICATION_FAILED":
    case "PROVIDER_REJECTED":
    case "PROVIDER_INVALID_RESPONSE":
      return "PROVIDER_REJECTED"
    case "PROVIDER_UNAVAILABLE":
      return "PROVIDER_UNAVAILABLE"
    default:
      return "IMAGE_GENERATION_FAILED"
  }
}

/**
 * Move the project out of GENERATING once no image is still in flight.
 *
 * The previous rule was "every image is COMPLETED", which meant a run with a
 * single failure never advanced: the project sat at GENERATING indefinitely, the
 * UI never offered evaluation or selection, and `ProjectStatus.FAILED` was
 * unreachable in the entire codebase.
 *
 * The rule now keys off work still pending rather than work that succeeded:
 *   - anything PENDING or GENERATING  -> still running, leave the status alone
 *   - at least one COMPLETED          -> IMAGES_READY, so a partially
 *                                        successful run is usable and the failed
 *                                        frames can be retried individually
 *   - nothing COMPLETED               -> FAILED
 */
export type SettleContext = {
  generatedImage: { count(args: unknown): Promise<number> }
  project: { update(args: unknown): Promise<unknown> }
}

export async function settleProjectStatus(
  transaction: SettleContext,
  projectId: string,
) {
  const inFlight = await transaction.generatedImage.count({
    where: { projectId, status: { in: ["PENDING", "GENERATING"] } },
  })
  if (inFlight > 0) return

  const completed = await transaction.generatedImage.count({
    where: { projectId, status: "COMPLETED" },
  })
  await transaction.project.update({
    where: { id: projectId },
    data: { status: completed > 0 ? "IMAGES_READY" : "FAILED" },
  })
}

export const prismaImageRunRepository: ImageRunRepository = {
  async getOwnedDirections(projectId, userId) {
    const project = await getPrisma().project.findFirst({
      where: { id: projectId, userId },
      select: { targetImageCount: true, directions: { orderBy: { position: "asc" }, select: { id: true, position: true, imagePrompt: true } } },
    })
    return project ?? null
  },
  async createPendingImages(projectId, directions) {
    const db = getPrisma()
    return db.$transaction(async (transaction) => {
      await transaction.generatedImage.createMany({
        data: directions.map((direction) => ({
          projectId,
          directionId: direction.id,
          position: direction.position,
          idempotencyKey: `${projectId}:image:${direction.position}:v1`,
        })),
        skipDuplicates: true,
      })
      await transaction.project.update({ where: { id: projectId }, data: { status: "GENERATING" } })
      return transaction.generatedImage.findMany({ where: { projectId }, orderBy: { position: "asc" } })
    })
  },
  async claimNextPendingImage(projectId) {
    const db = getPrisma()
    return db.$transaction(async (transaction) => {
      const now = new Date()
      await transaction.generatedImage.updateMany({
        where: { projectId, status: "GENERATING", leaseExpiresAt: { lt: now } },
        data: { status: "PENDING", leaseExpiresAt: null, safeErrorCode: "LEASE_RECOVERED" },
      })
      const active = await transaction.generatedImage.count({ where: { projectId, status: "GENERATING" } })
      if (active > 0) return null
      const next = await transaction.generatedImage.findFirst({
        where: { projectId, status: "PENDING" },
        orderBy: { position: "asc" },
        include: { direction: { select: { imagePrompt: true } } },
      })
      if (!next) return null
      const claimed = await transaction.generatedImage.updateMany({
        where: { id: next.id, status: "PENDING" },
        data: { status: "GENERATING", attempts: { increment: 1 }, startedAt: now, leaseExpiresAt: new Date(now.getTime() + 5 * 60_000), safeErrorCode: null },
      })
      if (claimed.count !== 1) return null
      return { id: next.id, projectId, position: next.position, imagePrompt: next.direction.imagePrompt, attempts: next.attempts + 1 }
    })
  },
  async completeImage(imageId, completion) {
    const db = getPrisma()
    return db.$transaction(async (transaction) => {
      const image = await transaction.generatedImage.update({
        // Guarded by the legal predecessor states from the state machine, so a
        // duplicate completion (two workers, or a retry racing a lease
        // recovery) is rejected by the database rather than overwriting a row
        // that has already settled.
        where: { id: imageId, status: { in: statesAllowedBefore("COMPLETED") } },
        data: {
          status: "COMPLETED",
          provider: completion.provider,
          model: completion.model,
          providerAssetId: completion.providerAssetId,
          storageKey: completion.key,
          url: completion.url,
          mimeType: completion.contentType,
          width: completion.width,
          height: completion.height,
          checksum: completion.checksum,
          completedAt: new Date(),
          leaseExpiresAt: null,
        },
      })
      await settleProjectStatus(transaction, image.projectId)
      return image
    })
  },
  async failImage(imageId, safeErrorCode) {
    const db = getPrisma()
    return db.$transaction(async (transaction) => {
      const image = await transaction.generatedImage.update({
        where: { id: imageId, status: { in: statesAllowedBefore("FAILED") } },
        data: { status: "FAILED", safeErrorCode, leaseExpiresAt: null },
      })
      // A failure has to settle the project too. Without this, the last image
      // in a run failing left the project pinned at GENERATING forever.
      await settleProjectStatus(transaction, image.projectId)
      return image
    })
  },
  async summarize(projectId) {
    return getPrisma().generatedImage.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      select: { id: true, position: true, status: true, url: true, safeErrorCode: true },
    })
  },
}
