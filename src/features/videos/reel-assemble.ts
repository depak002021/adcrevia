import { createComposition, renderComposition } from "@/features/compositions/service"
import { getPrisma } from "@/lib/db/prisma"

import { REEL_TRANSITION_MS } from "./reel-plan"

/**
 * Join a reel's clips once the last one has finished.
 *
 * Called whenever a render settles (see refreshVideoStatus). Most calls return at
 * once: the render is not part of a reel, or siblings are still rendering. When all
 * clips are complete, the reel is CLAIMED with a unique settings key before anything
 * is created, so two clips finishing at the same moment cannot both start a render.
 * The composition engine then crossfades picture and sound and normalises loudness.
 */

export type ReelMetadata = { id: string; index: number; count: number; transition: string; aspectRatio: string }

export function reelOf(metadata: unknown): ReelMetadata | null {
  const reel = metadata && typeof metadata === "object" ? (metadata as { reel?: unknown }).reel : null
  if (!reel || typeof reel !== "object") return null
  const value = reel as Partial<ReelMetadata>
  return typeof value.id === "string" && typeof value.index === "number" && typeof value.count === "number"
    ? { id: value.id, index: value.index, count: value.count, transition: value.transition ?? "CROSSFADE", aspectRatio: value.aspectRatio ?? "9:16" }
    : null
}

export const reelClaimKey = (reelId: string) => `reel:${reelId}`

/** Master formats the composition engine renders; the nearest one for other shapes. */
const MASTER_FOR: Record<string, string> = { "9:16": "9:16", "3:4": "4:5", "4:5": "4:5", "1:1": "1:1", "4:3": "16:9", "16:9": "16:9" }

export async function assembleReelIfReady(videoId: string, userId: string): Promise<string | null> {
  const db = getPrisma()
  const video = await db.generatedVideo.findFirst({
    where: { id: videoId, project: { userId } },
    select: { projectId: true, providerTaskMetadata: true },
  })
  const reel = reelOf(video?.providerTaskMetadata)
  if (!video || !reel) return null

  const clips = await db.generatedVideo.findMany({
    where: { projectId: video.projectId, providerTaskMetadata: { path: ["reel", "id"], equals: reel.id } },
    select: { id: true, status: true, providerTaskMetadata: true },
  })
  if (clips.length < reel.count || clips.some((clip) => clip.status !== "COMPLETED")) return null

  // Claim first: the unique key makes this the only caller that assembles the reel.
  try {
    await db.systemSetting.create({ data: { key: reelClaimKey(reel.id), value: { status: "assembling" } } })
  } catch {
    return null
  }

  const ordered = [...clips].sort((a, b) => (reelOf(a.providerTaskMetadata)?.index ?? 0) - (reelOf(b.providerTaskMetadata)?.index ?? 0))
  const hardCut = reel.transition === "NONE"
  const composition = await createComposition(
    {
      projectId: video.projectId,
      aspectRatio: MASTER_FOR[reel.aspectRatio] ?? "9:16",
      fps: 30,
      clips: ordered.map((clip) => ({
        videoId: clip.id,
        trimInMs: 0,
        trimOutMs: null,
        transition: reel.transition as "CROSSFADE",
        transitionMs: hardCut ? 0 : REEL_TRANSITION_MS,
        speed: 1,
      })),
    },
    userId,
  )
  await db.systemSetting.update({ where: { key: reelClaimKey(reel.id) }, data: { value: { compositionId: composition.id } } })
  await renderComposition(composition.id, userId)
  return composition.id
}
