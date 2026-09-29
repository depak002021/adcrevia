import type { CompositionStatus } from "@/generated/prisma/enums"
import { getPrisma } from "@/lib/db/prisma"
import { HttpError } from "@/lib/http/http-error"
import { scheduleComposition, scheduleExport } from "@/lib/jobs/schedule"
import { findPreset, masterGeometry } from "@/lib/video/presets"

import {
  validateClipWindows,
  type CompositionClipInput,
  type CompositionInput,
  type CompositionUpdateInput,
} from "./schemas"

/**
 * The edit, as data.
 *
 * A `GeneratedVideo` is one provider render. Until now there was no way to combine
 * several: no entity, no route, no ffmpeg. A composition is the decision about how
 * they go together, kept separate from the encoded results so the edit can be changed
 * without losing the history of what was rendered from it.
 *
 * Status is owned here rather than by the worker. `DRAFT` while it is being arranged,
 * `QUEUED` the moment a render is asked for, and only the worker moves it past that —
 * so a user who reorders clips mid-render cannot leave the row claiming to be
 * rendering something that no longer exists.
 */

/** Statuses from which a re-render may be started. */
const RENDERABLE: CompositionStatus[] = ["DRAFT", "COMPLETED", "FAILED"]

export type CompositionDto = {
  id: string
  projectId: string
  status: CompositionStatus
  aspectRatio: string
  width: number
  height: number
  fps: number
  durationMs: number | null
  url: string | null
  posterUrl: string | null
  safeErrorCode: string | null
  renderedAt: Date | null
  clips: Array<{
    id: string
    videoId: string
    position: number
    trimInMs: number
    trimOutMs: number | null
    transition: string
    transitionMs: number
    speed: number
    /** The source render, so the editor can show a thumbnail and its real length. */
    source: { url: string | null; durationSeconds: number | null; aspectRatio: string | null }
  }>
  renders: Array<{
    id: string
    preset: string
    label: string
    platform: string
    aspectRatio: string
    width: number
    height: number
    status: CompositionStatus
    url: string | null
    posterUrl: string | null
    bytes: number | null
    safeErrorCode: string | null
  }>
}

export async function createComposition(input: CompositionInput, userId: string): Promise<CompositionDto> {
  const windows = validateClipWindows(input.clips)
  if (!windows.ok) throw new HttpError(400, windows.reason)

  const db = getPrisma()
  await assertSourcesOwned(input.projectId, userId, input.clips)

  const geometry = masterGeometry(input.aspectRatio)
  const composition = await db.videoComposition.create({
    data: {
      projectId: input.projectId,
      aspectRatio: geometry.aspectRatio,
      width: geometry.width,
      height: geometry.height,
      fps: input.fps,
      clips: {
        create: input.clips.map((clip, index) => ({
          videoId: clip.videoId,
          position: index + 1,
          trimInMs: clip.trimInMs,
          trimOutMs: clip.trimOutMs,
          transition: clip.transition,
          transitionMs: clip.transitionMs,
          speed: clip.speed,
        })),
      },
    },
    select: { id: true },
  })

  return readComposition(composition.id, userId)
}

export async function updateComposition(
  compositionId: string,
  input: CompositionUpdateInput,
  userId: string,
): Promise<CompositionDto> {
  const db = getPrisma()
  const existing = await ownedComposition(compositionId, userId)

  if (existing.status === "QUEUED" || existing.status === "RENDERING") {
    // Editing under a running render would leave the output describing a timeline
    // that no longer exists, with nothing to say so.
    throw new HttpError(409, "COMPOSITION_IS_RENDERING")
  }

  if (input.clips) {
    const windows = validateClipWindows(input.clips)
    if (!windows.ok) throw new HttpError(400, windows.reason)
    await assertSourcesOwned(existing.projectId, userId, input.clips)
  }

  const geometry = input.aspectRatio ? masterGeometry(input.aspectRatio) : null

  await db.$transaction(async (transaction) => {
    await transaction.videoComposition.update({
      where: { id: compositionId },
      data: {
        ...(geometry
          ? { aspectRatio: geometry.aspectRatio, width: geometry.width, height: geometry.height }
          : {}),
        ...(input.fps ? { fps: input.fps } : {}),
        // Any edit invalidates what was rendered from the previous arrangement.
        ...(input.clips || geometry || input.fps
          ? { status: "DRAFT" as const, url: null, storageKey: null, durationMs: null, safeErrorCode: null }
          : {}),
      },
    })

    if (input.clips) {
      // Replaced rather than diffed. `@@unique([compositionId, position])` makes an
      // in-place reorder a sequence of conflicting updates, and the rows carry no
      // state worth preserving — the renders do, and they are keyed separately.
      await transaction.compositionClip.deleteMany({ where: { compositionId } })
      for (const [index, clip] of input.clips.entries()) {
        await transaction.compositionClip.create({
          data: {
            compositionId,
            videoId: clip.videoId,
            position: index + 1,
            trimInMs: clip.trimInMs,
            trimOutMs: clip.trimOutMs,
            transition: clip.transition,
            transitionMs: clip.transitionMs,
            speed: clip.speed,
          },
        })
      }
    }
  })

  return readComposition(compositionId, userId)
}

/** Queue the master render. */
export async function renderComposition(compositionId: string, userId: string) {
  const db = getPrisma()
  const composition = await ownedComposition(compositionId, userId)

  if (!RENDERABLE.includes(composition.status)) throw new HttpError(409, "COMPOSITION_IS_RENDERING")
  if (composition.clipCount === 0) throw new HttpError(400, "COMPOSITION_REQUIRES_A_CLIP")

  // Moved to QUEUED before the job is enqueued, so the UI reflects the request even
  // if the worker is busy. The worker owns every transition after this one.
  await db.videoComposition.update({
    where: { id: compositionId },
    data: { status: "QUEUED", safeErrorCode: null },
  })

  const job = await scheduleComposition({ compositionId, projectId: composition.projectId })
  return { jobId: job.id }
}

/** Queue one encoded output per requested destination. */
export async function exportComposition(compositionId: string, presets: string[], userId: string) {
  const db = getPrisma()
  const composition = await ownedComposition(compositionId, userId)

  // Exports re-frame the master, so there has to be one. Queueing them against an
  // unrendered composition would fail six times in the worker instead of once here.
  if (composition.status !== "COMPLETED" || !composition.storageKey) {
    throw new HttpError(409, "COMPOSITION_NOT_RENDERED")
  }

  const jobs: Array<{ preset: string; jobId: string }> = []

  for (const key of presets) {
    const preset = findPreset(key)
    if (!preset) throw new HttpError(400, "UNKNOWN_EXPORT_PRESET")

    await db.compositionRender.upsert({
      where: { compositionId_preset: { compositionId, preset: preset.key } },
      create: {
        compositionId,
        preset: preset.key,
        aspectRatio: preset.aspectRatio,
        width: preset.width,
        height: preset.height,
        status: "QUEUED",
      },
      // Re-exporting the same destination replaces it rather than accumulating rows;
      // the unique index means there is only ever one per preset anyway.
      update: { status: "QUEUED", safeErrorCode: null, url: null, storageKey: null },
    })

    const job = await scheduleExport({ compositionId, preset: preset.key, projectId: composition.projectId })
    jobs.push({ preset: preset.key, jobId: job.id })
  }

  return { jobs }
}

export async function readComposition(compositionId: string, userId: string): Promise<CompositionDto> {
  const composition = await getPrisma().videoComposition.findFirst({
    where: { id: compositionId, project: { userId } },
    select: {
      id: true,
      projectId: true,
      status: true,
      aspectRatio: true,
      width: true,
      height: true,
      fps: true,
      durationMs: true,
      url: true,
      posterUrl: true,
      safeErrorCode: true,
      renderedAt: true,
      clips: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          videoId: true,
          position: true,
          trimInMs: true,
          trimOutMs: true,
          transition: true,
          transitionMs: true,
          speed: true,
          video: { select: { url: true, durationSeconds: true, aspectRatio: true } },
        },
      },
      renders: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          preset: true,
          aspectRatio: true,
          width: true,
          height: true,
          status: true,
          url: true,
          posterUrl: true,
          bytes: true,
          safeErrorCode: true,
        },
      },
    },
  })
  if (!composition) throw new HttpError(404, "Composition not found")

  return {
    ...composition,
    clips: composition.clips.map(({ video, ...clip }) => ({ ...clip, source: video })),
    renders: composition.renders.map((render) => {
      const preset = findPreset(render.preset)
      return {
        ...render,
        // Labels live in the preset table, not the database: renaming a destination
        // must not need a migration, and the row already has the geometry.
        label: preset?.label ?? render.preset,
        platform: preset?.platform ?? "download",
      }
    }),
  }
}

/** Every composition on a project, newest first. */
export function listProjectCompositions(projectId: string) {
  return getPrisma().videoComposition.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      aspectRatio: true,
      durationMs: true,
      url: true,
      posterUrl: true,
      safeErrorCode: true,
      renderedAt: true,
      _count: { select: { clips: true, renders: true } },
    },
  })
}

async function ownedComposition(compositionId: string, userId: string) {
  const composition = await getPrisma().videoComposition.findFirst({
    where: { id: compositionId, project: { userId } },
    select: {
      id: true,
      projectId: true,
      status: true,
      storageKey: true,
      _count: { select: { clips: true } },
    },
  })
  if (!composition) throw new HttpError(404, "Composition not found")
  return { ...composition, clipCount: composition._count.clips }
}

/**
 * Every clip must reference a completed render on the same project, owned by the
 * caller.
 *
 * Checked as a set rather than one at a time: the interesting failure is a videoId
 * from somebody else's project, and a per-clip query would make that a timing signal.
 */
async function assertSourcesOwned(projectId: string, userId: string, clips: CompositionClipInput[]) {
  const ids = clips.map((clip) => clip.videoId)
  const found = await getPrisma().generatedVideo.findMany({
    where: { id: { in: ids }, projectId, status: "COMPLETED", url: { not: null }, project: { userId } },
    select: { id: true },
  })
  if (found.length !== new Set(ids).size) throw new HttpError(400, "CLIP_SOURCE_UNAVAILABLE")
}
