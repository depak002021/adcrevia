import { createHash } from "node:crypto"

import { Prisma } from "@/generated/prisma/client"
import { getPrisma } from "@/lib/db/prisma"
import { recordVideoGenerationLog } from "@/features/admin/logs/service"
import { readProjectReferences } from "@/features/projects/references"
import { assembleReelIfReady } from "./reel-assemble"
import { createActiveVideoProvider, createSeedanceProvider, createVideoProviderByName, createVideoProviderForRecord } from "@/lib/providers/runtime"
import {
  DEFAULT_SEEDANCE_RESOLUTION,
  DRAFT_FINAL_RESOLUTION,
  DRAFT_RESOLUTION,
  DRAFT_VALID_MS,
  estimateSeedanceCostUsd,
  seedanceCostFromTokens,
  seedanceModel,
  type SeedanceResolution,
} from "@/lib/providers/videos/seedance-models"
import { bflCost } from "@/lib/costs/pricing"
import { estimateClipCostUsd, klingModel, veoModel, type ClipModelSpec } from "@/lib/providers/videos/clip-models"
import type { VideoProvider, VideoTaskStatus } from "@/lib/providers/videos/types"
import { downloadAsWebMp4 } from "@/lib/video/normalize"
import { createStorageProvider } from "@/lib/storage/runtime"
import { prepareImageForProvider } from "@/lib/storage/provider-assets"
import type { StorageProvider } from "@/lib/storage/types"
import { scheduleVideoPoll } from "@/lib/jobs/schedule"
import { durationOptionsFor, providerSupportsAspectRatio, videoInputSchema, type VideoInput, type VideoProviderName } from "./schemas"
import { statesAllowedBefore } from "./state-machine"

export class VideoWorkflowError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = "VideoWorkflowError"
  }
}

const MAX_SOURCE_IMAGES = 10

/**
 * Whitelisted, client-facing shape for a generated video. Private provider
 * details (`providerTaskMetadata`, `providerTaskId`, `idempotencyKey`,
 * `technicalLogRef`, `storageKey`, ...) are intentionally excluded and must
 * never reach a route response.
 */
export type VideoDto = {
  id: string
  projectId: string
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  provider: string | null
  model: string | null
  url: string | null
  progress: number | null
  durationSeconds: number | null
  aspectRatio: string | null
  safeErrorCode: string | null
  /** Seedance 2.5 draft (480p preview) that can be rendered as the final video. */
  draft: boolean
  resolution: string | null
  createdAt: Date | null
  updatedAt: Date | null
  completedAt: Date | null
}

/**
 * Source row accepted by `toVideoDto`. Every field is optional so the single
 * serializer can be fed a full Prisma row, a partial update result, or the
 * in-flight refresh payload (which carries a transient `providerProgress`).
 */
type VideoDtoSource = {
  id?: string
  projectId?: string | null
  status?: VideoDto["status"]
  provider?: string | null
  model?: string | null
  url?: string | null
  progress?: number | null
  providerProgress?: number | null
  durationSeconds?: number | null
  aspectRatio?: string | null
  safeErrorCode?: string | null
  createdAt?: Date | string | null
  updatedAt?: Date | string | null
  completedAt?: Date | string | null
  // Persisted rows carry additional private fields (providerTaskMetadata,
  // providerTaskId, idempotencyKey, ...). They are accepted here but never
  // copied onto the DTO, so the index signature documents that extra keys are
  // tolerated and discarded.
  [key: string]: unknown
}

/**
 * Project a persisted video (or an in-flight refresh payload) onto the safe
 * public DTO. All route responses MUST pass through this function so private
 * provider fields can never leak.
 */
export function toVideoDto(video: VideoDtoSource): VideoDto {
  return {
    id: video.id ?? "",
    projectId: video.projectId ?? "",
    status: video.status ?? "PENDING",
    provider: video.provider ?? null,
    model: video.model ?? null,
    url: video.url ?? null,
    progress: video.progress ?? video.providerProgress ?? null,
    durationSeconds: video.durationSeconds ?? null,
    aspectRatio: video.aspectRatio ?? null,
    safeErrorCode: video.safeErrorCode ?? null,
    draft: metadataOf(video.providerTaskMetadata).draft === true,
    resolution: typeof metadataOf(video.providerTaskMetadata).resolution === "string"
      ? (metadataOf(video.providerTaskMetadata).resolution as string)
      : null,
    createdAt: toDateOrNull(video.createdAt),
    updatedAt: toDateOrNull(video.updatedAt),
    completedAt: toDateOrNull(video.completedAt),
  }
}

/** Non-secret render facts kept on the row (resolution, draft); never the polling URL. */
function metadataOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value : new Date(value)
}

type SelectedImage = { id: string; url: string }

type OwnedVideo = {
  id: string
  projectId: string
  providerTaskId: string | null
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  provider: string | null
  model: string | null
  providerTaskMetadata: Record<string, unknown> | null
  url: string | null
  durationSeconds: number | null
  aspectRatio: string | null
  safeErrorCode: string | null
  createdAt: Date | null
  /** Needed to report render duration on the terminal log row. */
  startedAt: Date | null
  updatedAt: Date | null
  completedAt: Date | null
}

export type CreateProcessingVideoInput = VideoInput & {
  userId: string
  sourceImageId: string
  provider: string
  model: string
  providerTaskId: string
  providerTaskMetadata: Prisma.InputJsonValue | null
  idempotencyKey: string
  sources: Array<{ imageId: string; position: number }>
}

export type VideoRepository = {
  getSelectedImages(projectId: string, userId: string): Promise<SelectedImage[]>
  findByIdempotencyKey(key: string, userId: string): Promise<unknown | null>
  createProcessingVideo(input: CreateProcessingVideoInput): Promise<unknown>
  getOwnedVideo(videoId: string, userId: string): Promise<OwnedVideo | null>
  updateStatus(videoId: string, status: "PROCESSING" | "FAILED", safeErrorCode?: string): Promise<unknown>
  completeVideo(videoId: string, stored: { key: string; url: string; etag?: string }): Promise<any>
}

type StartDependencies = {
  provider?: VideoProvider
  repository?: VideoRepository
  /** Test seam; defaults to the product photos saved with the project. */
  readReferences?: (projectId: string) => Promise<string[]>
}
type RefreshDependencies = {
  provider?: VideoProvider
  createProviderForRecord?: (provider: string, model: string) => Promise<VideoProvider>
  storage?: StorageProvider
  repository?: VideoRepository
}

export async function startVideoGeneration(
  raw: unknown,
  userId: string,
  dependencies?: StartDependencies,
) {
  return startRender(videoInputSchema.parse(raw), userId, dependencies)
}

/**
 * How a reel clip differs from a plain render: its own frames from the storyboard,
 * its place in the reel (part of its identity, so two clips of one reel are never
 * mistaken for a resubmission), and the shot it plays.
 */
export type RenderOptions = {
  /** Frames to use instead of the whole saved selection (reel clips). */
  sources?: SelectedImage[]
  /** Extra identity for idempotency (reel id and clip index). */
  salt?: string
  /** Non-secret facts stored with the render (the reel it belongs to). */
  metadata?: Record<string, unknown>
  /** Appended to the prompt (the clip's shot direction). */
  direction?: string
}

export async function startRender(
  input: VideoInput,
  userId: string,
  dependencies?: StartDependencies,
  options: RenderOptions = {},
) {
  const repository = dependencies?.repository ?? prismaVideoRepository

  const selectedImages = options.sources ?? (await repository.getSelectedImages(input.projectId, userId))
  if (selectedImages.length === 0) throw new VideoWorkflowError("SELECTED_IMAGE_REQUIRED")
  if (selectedImages.length > MAX_SOURCE_IMAGES) throw new VideoWorkflowError("TOO_MANY_SOURCE_IMAGES")

  // Resolve the provider BEFORE hashing so the render is pinned to a concrete
  // provider/model and capability is validated up front. Honor an explicit user
  // choice; otherwise fall back to the active provider.
  const provider = dependencies?.provider
    ?? (input.provider ? await createVideoProviderByName(input.provider, input.model) : await createActiveVideoProvider())
  if (!providerSupportsAspectRatio(provider.name as VideoProviderName, input.aspectRatio)) {
    throw new VideoWorkflowError("ASPECT_RATIO_UNSUPPORTED")
  }
  // Every limit is checked here, before the provider is called: a request the
  // provider would reject is a 400 for the user, never a paid failed call.
  if (!durationOptionsFor(provider.name as VideoProviderName, provider.model).includes(input.duration)) {
    throw new VideoWorkflowError("DURATION_UNSUPPORTED")
  }
  // Per-second clip providers (Veo, Kling): 720p or 1080p; Veo 1080p only at 8 s.
  const clip = clipSpec(provider)
  const clipResolution = clip ? (input.resolution === "1080p" ? "1080p" : "720p") : undefined
  if (clip && input.resolution && !clip.resolutions.includes(input.resolution as "720p" | "1080p")) {
    throw new VideoWorkflowError("RESOLUTION_UNSUPPORTED")
  }
  if (provider.name === "google" && clipResolution === "1080p" && input.duration !== 8) {
    throw new VideoWorkflowError("RESOLUTION_UNSUPPORTED")
  }
  if (input.draft && provider.name !== "seedance") throw new VideoWorkflowError("DRAFT_UNSUPPORTED")
  const seedance = provider.name === "seedance" ? seedanceModel(provider.model) : undefined
  if (input.draft && !seedance?.draft) throw new VideoWorkflowError("DRAFT_UNSUPPORTED")
  const resolution: SeedanceResolution | undefined = seedance
    ? input.draft
      ? DRAFT_RESOLUTION
      : (input.resolution ?? DEFAULT_SEEDANCE_RESOLUTION)
    : undefined
  if (seedance && resolution && !seedance.resolutions.includes(resolution)) {
    throw new VideoWorkflowError("RESOLUTION_UNSUPPORTED")
  }
  const generateAudio = seedance ? (input.generateAudio ?? true) : undefined

  // Photos of the real product, for providers that take references (Seedance).
  const readReferences = dependencies ? dependencies.readReferences : readProjectReferences
  const takesReferences = Boolean(seedance) || (provider.name === "google" && (clip?.referenceImages ?? 0) > 0)
  const referenceImages =
    takesReferences && readReferences ? await readReferences(input.projectId).catch(() => [] as string[]) : []

  // Prepare every source URL (local assets become inline data URLs) while
  // preserving the selection order returned by the repository.
  const sourceImages = await Promise.all(
    selectedImages.map(async (image, index) => ({
      id: image.id,
      url: await prepareImageForProvider(image.url),
      position: index + 1,
    })),
  )

  const idempotencyKey = createHash("sha256")
    .update(
      JSON.stringify({
        projectId: input.projectId,
        sourceImageIds: selectedImages.map(({ id }) => id),
        prompt: input.prompt,
        motionStyle: input.motionStyle,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        provider: provider.name,
        model: provider.model,
        // Options that change what is rendered (and billed) are part of the identity;
        // absent for providers without them, so existing keys are unchanged.
        ...(seedance ? { draft: Boolean(input.draft), resolution, generateAudio, references: referenceImages.length } : {}),
        ...(clip ? { resolution: clipResolution, audio: input.generateAudio !== false, references: referenceImages.length } : {}),
        ...(options.salt ? { salt: options.salt } : {}),
      }),
    )
    .digest("hex")

  const existing = await repository.findByIdempotencyKey(idempotencyKey, userId)
  if (existing) {
    // Resubmitting the same request must not start a second render, but it should
    // still guarantee a reconciler exists — the original one may have exhausted
    // its polling budget while nobody was watching.
    const existingDto = toVideoDto(existing as VideoDtoSource)
    if (existingDto.status === "PENDING" || existingDto.status === "PROCESSING") {
      await ensureVideoReconciler(existingDto.id, userId)
    }
    return existingDto
  }

  const task = await provider.create({
    sourceImages,
    prompt: [motionStyleInstruction(input.motionStyle), input.prompt, options.direction].filter(Boolean).join(" "),
    duration: input.duration,
    aspectRatio: input.aspectRatio,
    ...(seedance ? { referenceImages, draft: Boolean(input.draft), resolution, generateAudio } : {}),
    ...(clip ? { referenceImages, resolution: clipResolution, generateAudio: input.generateAudio !== false } : {}),
  })

  const created = await repository.createProcessingVideo({
    ...input,
    userId,
    sourceImageId: selectedImages[0].id,
    provider: provider.name,
    model: provider.model,
    providerTaskId: task.taskId,
    providerTaskMetadata: toInputJson(options.metadata ? { ...task.taskMetadata, ...options.metadata } : task.taskMetadata),
    idempotencyKey,
    sources: selectedImages.map((image, index) => ({ imageId: image.id, position: index + 1 })),
  })
  const createdId = (created as { id?: string }).id ?? null

  // Hand the render to the queue so it is reconciled whether or not a browser
  // stays open. The client may still poll for a responsive UI, but it is no
  // longer the only thing that can collect the result — previously a closed tab
  // left the row PROCESSING permanently.
  if (createdId) await ensureVideoReconciler(createdId, userId)

  await recordVideoGenerationLog({
    projectId: input.projectId,
    videoId: createdId,
    status: "STARTED",
    provider: provider.name,
    model: provider.model,
    providerTaskId: task.taskId,
    details: {
      sources: selectedImages.length,
      aspectRatio: input.aspectRatio,
      duration: input.duration,
      ...(seedance && resolution
        ? {
            draft: Boolean(input.draft),
            resolution,
            audio: generateAudio,
            productReferences: referenceImages.length,
            estimatedUsd: estimateSeedanceCostUsd(provider.model, input.duration, resolution),
          }
        : {}),
      ...(clip && clipResolution
        ? {
            resolution: clipResolution,
            productReferences: referenceImages.length,
            estimatedUsd: estimateClipCostUsd(clip, input.duration, clipResolution),
          }
        : {}),
    },
  })
  return toVideoDto(created as VideoDtoSource)
}

export async function refreshVideoStatus(
  videoId: string,
  userId: string,
  dependencies?: RefreshDependencies,
  /** `worker: true` only from the queue handler: it may run the heavy H.264 encode. */
  options: { worker?: boolean } = {},
) {
  const storage = dependencies?.storage ?? (await createStorageProvider())
  const repository = dependencies?.repository ?? prismaVideoRepository
  const buildProvider = dependencies?.createProviderForRecord ?? createVideoProviderForRecord

  const video = await repository.getOwnedVideo(videoId, userId)
  if (!video) throw new VideoWorkflowError("VIDEO_NOT_FOUND")
  if (video.status === "COMPLETED" || video.status === "FAILED") return toVideoDto(video)
  if (!video.providerTaskId) throw new VideoWorkflowError("PROVIDER_TASK_REQUIRED")
  if (!video.provider) throw new VideoWorkflowError("PROVIDER_TASK_REQUIRED")

  // Always talk to the provider RECORDED on the video (never the active one) so
  // an in-flight task is polled by the provider that accepted it, using its
  // stored task metadata (e.g. the private BFL polling URL).
  const provider = await buildProvider(video.provider, video.model ?? "")
  let status: VideoTaskStatus
  try {
    status = await provider.getStatus(video.providerTaskId, video.providerTaskMetadata ?? undefined)
  } catch (error) {
    // A status link the provider now refuses for good (the task expired or is
    // unknown: 400/401/403/404) can never advance. It used to be retried 120 times
    // while the video spun forever; it is a failure.
    if (!isPermanentStatusError(error)) throw error
    status = { state: "FAILED", errorCode: "PROVIDER_TASK_LOST" }
  }
  // No render legitimately takes this long; stop waiting and say so.
  if (status.state !== "SUCCEEDED" && status.state !== "FAILED" && (elapsedSince(video.startedAt) ?? 0) > VIDEO_RENDER_DEADLINE_MS) {
    status = { state: "FAILED", errorCode: "VIDEO_TIMED_OUT" }
  }

  const metadata = metadataOf(video.providerTaskMetadata)
  const cost = costDetails(video.provider, video.model, status, metadata)

  if (status.state === "FAILED") {
    const safeErrorCode = status.errorCode ?? "VIDEO_PROVIDER_FAILED"
    const failed = await repository.updateStatus(video.id, "FAILED", safeErrorCode)
    // Terminal outcomes were never logged: only STARTED rows were ever written,
    // so the admin console could show a render beginning and never show how it
    // ended. Both terminal branches now record a row.
    await recordVideoGenerationLog({
      projectId: video.projectId,
      videoId: video.id,
      status: "FAILED",
      provider: video.provider ?? "unknown",
      model: video.model,
      providerTaskId: video.providerTaskId,
      safeErrorCode,
      durationMs: elapsedSince(video.startedAt),
      details: cost,
    })
    return toVideoDto(failed as VideoDtoSource)
  }
  if (status.state === "QUEUED" || status.state === "RUNNING") {
    const updated = await repository.updateStatus(video.id, "PROCESSING")
    return toVideoDto({ ...(updated as VideoDtoSource), providerProgress: status.progress })
  }
  if (!status.outputUrl) throw new VideoWorkflowError("PROVIDER_OUTPUT_REQUIRED")

  // Seedance 1080p is 10-bit H.265, which many browsers cannot play. It is re-encoded
  // to H.264 once, in the worker; a browser poll leaves it for the worker instead of
  // blocking a request for a minute of encoding (or encoding it twice).
  const needsWebEncode = video.provider === "seedance" && metadata.resolution === DRAFT_FINAL_RESOLUTION
  if (needsWebEncode && !options.worker) {
    const updated = await repository.updateStatus(video.id, "PROCESSING")
    return toVideoDto({ ...(updated as VideoDtoSource), providerProgress: 99 })
  }

  const key = `projects/${video.projectId}/videos/${video.id}.mp4`
  let stored: { url: string; etag?: string }
  if (provider.download) {
    // Outputs that need the provider's credentials to fetch (Veo).
    const file = await provider.download(status.outputUrl)
    stored = await storage.put({ key, bytes: file.bytes, contentType: "video/mp4" })
  } else if (needsWebEncode) {
    const encoded = await downloadAsWebMp4(status.outputUrl)
    stored = await storage.put({ key, bytes: encoded.bytes, contentType: "video/mp4" })
  } else {
    if (!storage.copyRemote) throw new VideoWorkflowError("PROVIDER_OUTPUT_REQUIRED")
    stored = await storage.copyRemote({ key, sourceUrl: status.outputUrl, contentType: "video/mp4" })
  }
  const completed = await repository.completeVideo(video.id, { key, ...stored })
  await recordVideoGenerationLog({
    projectId: video.projectId,
    videoId: video.id,
    status: "SUCCEEDED",
    provider: video.provider ?? "unknown",
    model: video.model,
    providerTaskId: video.providerTaskId,
    durationMs: elapsedSince(video.startedAt),
    details: cost,
  })
  // Part of an automatic reel? Join the clips once the last one is in. Best-effort:
  // the clip itself is done, and the next clip to finish checks again.
  await assembleReelIfReady(video.id, userId).catch((error) => {
    console.error("[videos] reel assembly failed", { videoId: video.id, reason: error instanceof Error ? error.message.slice(0, 80) : "unknown" })
  })
  return toVideoDto(completed as VideoDtoSource)
}

/**
 * What a finished Seedance render cost, from the tokens BytePlus reported. Recorded
 * on the log row so every paid call can be accounted for in Admin → Generation logs.
 */
function costDetails(
  provider: string | null,
  model: string | null,
  status: VideoTaskStatus,
  metadata: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (provider === "bfl") {
    // BFL reports the credits charged when the render is submitted.
    const credits = typeof metadata.bflCredits === "number" ? metadata.bflCredits : null
    // Billed at submission, so a render that later fails still cost the credits.
    return { costUsd: credits !== null ? bflCost(credits)?.usd ?? null : null }
  }
  if ((provider === "google" || provider === "kling") && model) {
    // Billed per second of output, only when the render succeeds: the cost is exact.
    const spec = provider === "google" ? veoModel(model) : klingModel(model)
    const clipResolution = metadata.resolution === "1080p" ? "1080p" : "720p"
    const seconds = typeof metadata.duration === "number" ? metadata.duration : null
    return {
      resolution: clipResolution,
      costUsd: status.state === "SUCCEEDED" && seconds ? estimateClipCostUsd(spec, seconds, clipResolution) : 0,
    }
  }
  if (provider !== "seedance" || !model) return undefined
  const resolution = (typeof metadata.resolution === "string" ? metadata.resolution : DEFAULT_SEEDANCE_RESOLUTION) as SeedanceResolution
  const tokens = status.usage?.tokens
  return {
    resolution,
    draft: metadata.draft === true,
    // BytePlus's billed tokens. Not named "tokens": the log sanitiser redacts any key
    // containing "token" as a possible credential.
    billedUnits: tokens ?? null,
    costUsd: typeof tokens === "number" ? seedanceCostFromTokens(model, tokens, resolution) : null,
  }
}

/** Limits and prices for per-second clip providers (Veo, Kling); undefined otherwise. */
function clipSpec(provider: VideoProvider): ClipModelSpec | undefined {
  if (provider.name === "google") return veoModel(provider.model)
  if (provider.name === "kling") return klingModel(provider.model)
  return undefined
}

/**
 * Render the final video from an approved Seedance 2.5 draft.
 *
 * BytePlus reuses the draft's prompt, references, duration, ratio, seed and audio, so
 * the final matches what the user approved; it renders 1080p only (re-encoded to
 * H.264 on collection). Idempotent per draft: asking twice returns the same final.
 */
export async function finalizeDraftVideo(videoId: string, userId: string) {
  const db = getPrisma()
  const draft = await db.generatedVideo.findFirst({
    where: { id: videoId, project: { userId } },
    include: { sources: { orderBy: { position: "asc" }, select: { imageId: true, position: true } } },
  })
  if (!draft) throw new VideoWorkflowError("VIDEO_NOT_FOUND")
  const metadata = metadataOf(draft.providerTaskMetadata)
  if (draft.provider !== "seedance" || metadata.draft !== true || !draft.providerTaskId || !draft.model) {
    throw new VideoWorkflowError("NOT_A_DRAFT")
  }
  if (draft.status !== "COMPLETED") throw new VideoWorkflowError("DRAFT_NOT_READY")
  if (Date.now() - draft.createdAt.getTime() > DRAFT_VALID_MS) throw new VideoWorkflowError("DRAFT_EXPIRED")

  const idempotencyKey = createHash("sha256").update(`seedance-final:${draft.id}`).digest("hex")
  const existing = await prismaVideoRepository.findByIdempotencyKey(idempotencyKey, userId)
  if (existing) {
    const dto = toVideoDto(existing as VideoDtoSource)
    if (dto.status === "PENDING" || dto.status === "PROCESSING") await ensureVideoReconciler(dto.id, userId)
    return dto
  }

  const provider = await createSeedanceProvider(draft.model)
  const task = await provider.createFromDraft(draft.providerTaskId)
  const created = await prismaVideoRepository.createProcessingVideo({
    projectId: draft.projectId,
    prompt: draft.instructions,
    motionStyle: draft.motionStyle as VideoInput["motionStyle"],
    duration: draft.durationSeconds,
    aspectRatio: draft.aspectRatio as VideoInput["aspectRatio"],
    userId,
    sourceImageId: draft.sourceImageId,
    provider: provider.name,
    model: provider.model,
    providerTaskId: task.taskId,
    providerTaskMetadata: toInputJson({ ...task.taskMetadata, draftVideoId: draft.id }),
    idempotencyKey,
    sources: draft.sources.map((source) => ({ imageId: source.imageId, position: source.position })),
  })
  const createdId = (created as { id?: string }).id ?? null
  if (createdId) await ensureVideoReconciler(createdId, userId)
  await recordVideoGenerationLog({
    projectId: draft.projectId,
    videoId: createdId,
    status: "STARTED",
    provider: provider.name,
    model: provider.model,
    providerTaskId: task.taskId,
    details: {
      finalOfDraft: draft.id,
      resolution: DRAFT_FINAL_RESOLUTION,
      duration: draft.durationSeconds,
      estimatedUsd: estimateSeedanceCostUsd(provider.model, draft.durationSeconds, DRAFT_FINAL_RESOLUTION),
    },
  })
  return toVideoDto(created as VideoDtoSource)
}

/**
 * Schedule background reconciliation for a render.
 *
 * Best-effort on purpose. If the queue insert fails, the render itself has
 * already been submitted successfully and the client is still polling, so
 * failing the request would be a worse outcome than losing the background
 * reconciler. The failure is logged rather than swallowed silently.
 */
async function ensureVideoReconciler(videoId: string, userId: string) {
  try {
    await scheduleVideoPoll({ videoId, userId })
  } catch (error) {
    console.error("[videos] could not schedule reconciliation", {
      videoId,
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
  }
}

/** Wall-clock duration of the render, for the admin log. Null when unknown. */
/** Longest any provider has been allowed to render one clip before we give up. */
const VIDEO_RENDER_DEADLINE_MS = 30 * 60_000

function isPermanentStatusError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const { status, code } = error as { status?: unknown; code?: unknown }
  if (code === "PROVIDER_AUTHENTICATION_FAILED") return true
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429
}

/**
 * Settle a video whose status could not be read however many times it was asked
 * (the poll job ran out of attempts). Without this the row stayed PROCESSING and the
 * screen waited forever.
 */
export async function failUnfinishedVideo(videoId: string, safeErrorCode: string) {
  const db = getPrisma()
  const video = await db.generatedVideo.findUnique({ where: { id: videoId } })
  if (!video || video.status === "COMPLETED" || video.status === "FAILED") return
  await db.generatedVideo.update({ where: { id: videoId }, data: { status: "FAILED", safeErrorCode } })
  await recordVideoGenerationLog({
    projectId: video.projectId,
    videoId: video.id,
    status: "FAILED",
    provider: video.provider ?? "unknown",
    model: video.model,
    providerTaskId: video.providerTaskId,
    safeErrorCode,
    durationMs: elapsedSince(video.startedAt),
  })
}

function elapsedSince(startedAt: Date | null | undefined) {
  if (!startedAt) return undefined
  return Date.now() - new Date(startedAt).getTime()
}

export async function getOwnedVideo(videoId: string, userId: string) {
  const video = await prismaVideoRepository.getOwnedVideo(videoId, userId)
  if (!video) throw new VideoWorkflowError("VIDEO_NOT_FOUND")
  return toVideoDto(video)
}

/**
 * Providers return task metadata as `Record<string, unknown>` (parsed from a
 * JSON response). Prisma's JSON columns require `Prisma.InputJsonValue`, so we
 * round-trip through JSON to guarantee the value is genuinely serializable
 * before it is written, rather than casting `unknown` values through `any`.
 */
function toInputJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | null {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

/**
 * Appended to every video prompt. Models otherwise add captions, fake app interfaces
 * and extra lettering (seen in testing: a "Reels" label and a duplicated "Holi" under
 * the real print), none of which can be removed after the render.
 */
const CLEAN_FRAME =
  "No on-screen text, captions, subtitles, app interface, logos or watermarks. Keep the product's own print and lettering exactly as shown; add no other lettering."

function motionStyleInstruction(style: VideoInput["motionStyle"]) {
  return `${styleInstruction(style)} ${CLEAN_FRAME}`
}

function styleInstruction(style: VideoInput["motionStyle"]) {
  return {
    // No platform names: a model told "Reels"/"TikTok" draws their app interface into the frame.
    UGC: "Authentic creator-style UGC ad: handheld phone camera, natural light, a real person using and showing the product, quick relatable moments.",
    PRODUCT_360: "Smooth 360-degree turntable orbit around the product, revealing every side at an even pace; the product stays centred, sharp and identical throughout, clean background.",
    CINEMATIC: "Cinematic camera movement, polished commercial pacing.",
    PRODUCT_COMMERCIAL: "Premium product-commercial motion that protects product geometry.",
    LUXURY: "Slow, refined luxury movement with controlled highlights.",
    DYNAMIC: "Energetic but legible camera and environmental motion.",
    MINIMAL: "Subtle minimal movement with a locked, product-first composition.",
    CUSTOM: "Follow the custom motion direction precisely.",
  }[style]
}

export const prismaVideoRepository: VideoRepository = {
  async getSelectedImages(projectId, userId) {
    const selections = await getPrisma().imageSelection.findMany({
      where: { projectId, project: { userId }, image: { status: "COMPLETED", url: { not: null } } },
      orderBy: { position: "asc" },
      select: { image: { select: { id: true, url: true } } },
    })
    return selections
      .filter((selection): selection is { image: { id: string; url: string } } => Boolean(selection.image.url))
      .map((selection) => ({ id: selection.image.id, url: selection.image.url }))
  },
  findByIdempotencyKey(key, userId) {
    return getPrisma().generatedVideo.findFirst({ where: { idempotencyKey: key, project: { userId } } })
  },
  async createProcessingVideo(input) {
    const db = getPrisma()
    return db.$transaction(async (transaction) => {
      const video = await transaction.generatedVideo.create({
        data: {
          projectId: input.projectId,
          sourceImageId: input.sourceImageId,
          status: "PROCESSING",
          provider: input.provider,
          model: input.model,
          providerTaskId: input.providerTaskId,
          providerTaskMetadata: input.providerTaskMetadata ?? Prisma.JsonNull,
          motionStyle: input.motionStyle,
          instructions: input.prompt,
          durationSeconds: input.duration,
          aspectRatio: input.aspectRatio,
          idempotencyKey: input.idempotencyKey,
          attempts: 1,
          startedAt: new Date(),
          sources: {
            create: input.sources.map((source) => ({ imageId: source.imageId, position: source.position })),
          },
        },
      })
      await transaction.project.update({ where: { id: input.projectId }, data: { status: "VIDEO_GENERATING" } })
      return video
    })
  },
  getOwnedVideo(videoId, userId) {
    return getPrisma().generatedVideo.findFirst({
      where: { id: videoId, project: { userId } },
      select: {
        id: true,
        projectId: true,
        providerTaskId: true,
        status: true,
        provider: true,
        model: true,
        providerTaskMetadata: true,
        url: true,
        durationSeconds: true,
        aspectRatio: true,
        safeErrorCode: true,
        createdAt: true,
        startedAt: true,
        updatedAt: true,
        completedAt: true,
      },
    }) as Promise<OwnedVideo | null>
  },
  updateStatus(videoId, status, safeErrorCode) {
    // Guarded by the legal predecessors from the state machine so a late poll
    // cannot move a row that has already reached a terminal state.
    //
    // PROCESSING additionally permits itself. A status refresh re-affirms an
    // in-flight render rather than transitioning it, and rows are created
    // directly as PROCESSING (the provider task is submitted before the row is
    // written, so PENDING is never occupied). Without the self-allowance every
    // poll of a running render would match zero rows and throw.
    const allowed =
      status === "PROCESSING"
        ? [...statesAllowedBefore(status), "PROCESSING" as const]
        : statesAllowedBefore(status)
    return getPrisma().generatedVideo.update({
      where: { id: videoId, status: { in: allowed } },
      data: { status, safeErrorCode },
    })
  },
  async completeVideo(videoId, stored) {
    const db = getPrisma()
    return db.$transaction(async (transaction) => {
      const video = await transaction.generatedVideo.update({
        where: { id: videoId, status: { in: statesAllowedBefore("COMPLETED") } },
        data: { status: "COMPLETED", storageKey: stored.key, url: stored.url, mimeType: "video/mp4", completedAt: new Date() },
      })
      await transaction.project.update({ where: { id: video.projectId }, data: { status: "COMPLETED" } })
      return video
    })
  },
}
