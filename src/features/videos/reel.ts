import { randomUUID } from "node:crypto"

import { z } from "zod"

import { readComposition } from "@/features/compositions/service"
import { getPrisma } from "@/lib/db/prisma"
import { createVideoProviderByName } from "@/lib/providers/runtime"
import { klingModel, veoModel } from "@/lib/providers/videos/clip-models"
import type { VideoProvider } from "@/lib/providers/videos/types"

import { reelClaimKey, reelOf } from "./reel-assemble"
import { planReel, REEL_TRANSITIONS, shotDirection, type ReelPlan } from "./reel-plan"
import { aspectRatios, durationOptionsFor, motionStyles, type VideoProviderName } from "./schemas"
import { prismaVideoRepository, startRender, toVideoDto, VideoWorkflowError } from "./service"

/**
 * A reel longer than one render: plan the clips, start them, and let the worker join
 * them (reel-assemble.ts) when the last one finishes.
 *
 * Every clip goes through startRender — the same limits, product references,
 * idempotency and cost log as a single video. All clips share the settings the first
 * one is validated against, so a request that would be refused is refused before the
 * first paid call, never halfway through a reel.
 */

export const reelInputSchema = z.object({
  projectId: z.string().cuid(),
  prompt: z.string().trim().min(8).max(2000),
  motionStyle: z.enum(motionStyles),
  targetSeconds: z.number().int().min(10).max(60),
  aspectRatio: z.enum(aspectRatios),
  provider: z.enum(["runway", "bfl", "seedance", "google", "kling"]),
  model: z.string().max(100),
  resolution: z.enum(["480p", "720p", "1080p"]).optional(),
  generateAudio: z.boolean().optional(),
  transition: z.enum(REEL_TRANSITIONS).default("CROSSFADE"),
})

/** Can the model end a clip on a chosen frame (so consecutive clips join seamlessly)? */
function closesOnFrame(provider: VideoProvider): boolean {
  if (provider.name === "kling") return klingModel(provider.model).lastFrame
  if (provider.name === "google") return veoModel(provider.model).lastFrame
  // FLUX takes several keyframes, Seedance several references; Runway exactly one image.
  return provider.name === "bfl" || provider.name === "seedance"
}

export function planFor(provider: VideoProvider, targetSeconds: number, sceneCount: number, transition: (typeof REEL_TRANSITIONS)[number]): ReelPlan | null {
  return planReel({
    targetSeconds,
    durations: durationOptionsFor(provider.name as VideoProviderName, provider.model),
    sceneCount,
    lastFrame: closesOnFrame(provider),
    transition,
  })
}

export async function startReel(raw: unknown, userId: string) {
  const input = reelInputSchema.parse(raw)
  const provider = await createVideoProviderByName(input.provider, input.model)
  const scenes = await prismaVideoRepository.getSelectedImages(input.projectId, userId)
  if (scenes.length === 0) throw new VideoWorkflowError("SELECTED_IMAGE_REQUIRED")

  const plan = planFor(provider, input.targetSeconds, scenes.length, input.transition)
  if (!plan) throw new VideoWorkflowError("REEL_NOT_NEEDED")

  const reelId = randomUUID()
  const clips = []
  for (const clip of plan.clips) {
    const sources = [scenes[clip.firstScene], ...(clip.lastScene !== null && clip.lastScene !== clip.firstScene ? [scenes[clip.lastScene]] : [])]
    clips.push(
      await startRender(
        {
          projectId: input.projectId,
          prompt: input.prompt,
          motionStyle: input.motionStyle,
          duration: clip.seconds,
          aspectRatio: input.aspectRatio,
          provider: input.provider,
          model: provider.model,
          resolution: input.resolution,
          generateAudio: input.generateAudio,
        },
        userId,
        undefined,
        {
          sources,
          salt: `${reelId}:${clip.index}`,
          metadata: { reel: { id: reelId, index: clip.index, count: plan.clips.length, transition: input.transition, aspectRatio: input.aspectRatio } },
          direction: shotDirection(clip.index, plan.clips.length),
        },
      ),
    )
  }
  return { reelId, plan, clips }
}

/** Progress for the studio: each clip, then the joined reel once it exists. */
export async function readReel(reelId: string, userId: string) {
  const db = getPrisma()
  const videos = await db.generatedVideo.findMany({
    where: { project: { userId }, providerTaskMetadata: { path: ["reel", "id"], equals: reelId } },
    include: { sourceImage: { select: { url: true } } },
  })
  if (videos.length === 0) throw new VideoWorkflowError("VIDEO_NOT_FOUND")
  const clips = videos
    .map((video) => ({ ...toVideoDto(video), index: reelOf(video.providerTaskMetadata)?.index ?? 0, posterUrl: video.sourceImage.url ?? null }))
    .sort((a, b) => a.index - b.index)

  const claim = await db.systemSetting.findUnique({ where: { key: reelClaimKey(reelId) } })
  const compositionId = (claim?.value as { compositionId?: string } | null)?.compositionId
  const composition = compositionId ? await readComposition(compositionId, userId).catch(() => null) : null
  const reelMeta = reelOf(videos[0].providerTaskMetadata) as { count?: number; transition?: string } | null
  return {
    reelId,
    count: reelMeta?.count ?? clips.length,
    transition: typeof reelMeta?.transition === "string" ? reelMeta.transition : null,
    clips,
    composition: composition
      ? { id: composition.id, status: composition.status, url: composition.url, durationMs: composition.durationMs, safeErrorCode: composition.safeErrorCode }
      : null,
  }
}
