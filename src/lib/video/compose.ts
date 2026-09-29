import { getPrisma } from "@/lib/db/prisma"
import { createStorageProvider } from "@/lib/storage/runtime"
import type { StorageProvider } from "@/lib/storage/types"

import { FfmpegError, probeVideo, runFfmpeg } from "./ffmpeg"
import {
  buildCompositionGraph,
  buildExportGraph,
  buildPosterArgs,
  plannedDurationMs,
  type GraphClip,
} from "./filter-graph"
import { chooseFit, findPreset } from "./presets"
import { createRenderWorkspace, workspaceName, WorkspaceError } from "./workspace"

/**
 * Rendering a composition.
 *
 * The shape of the work: pull the sources down, measure what actually arrived, build
 * the graph from the measurements, encode, extract a poster, upload both, record the
 * result. Two of those steps exist because of things that go wrong silently.
 *
 * Sources are measured rather than trusted. A provider asked for five seconds routinely
 * returns 4.8, and a graph built on the request rather than the file puts every
 * transition after the first in the wrong place — the render succeeds and looks
 * subtly wrong, which is the worst kind of bug to find later.
 *
 * The output is measured too. ffmpeg exiting zero means it wrote a file, not that the
 * file is the edit that was asked for.
 */

/** How far the rendered file may sit from the plan before it is treated as wrong. */
const DURATION_TOLERANCE_MS = 750

/** Progress is reported against these bands so the bar moves through the whole job. */
const FETCH_SHARE = 0.25
const ENCODE_SHARE = 0.65

export type ComposeProgress = (progress: number, label: string) => Promise<void>

export type ComposeDependencies = {
  storage?: StorageProvider
  /**
   * Threads x264 may use. Deliberately low: the worker shares four cores with the web
   * process and two other stacks, and an encode that saturates them makes every page
   * on the host slow.
   */
  threads?: number
}

export class ComposeError extends Error {
  constructor(
    readonly safeErrorCode: string,
    readonly detail?: string,
  ) {
    super(detail ? `${safeErrorCode}: ${detail}` : safeErrorCode)
    this.name = "ComposeError"
  }
}

export async function renderCompositionMaster(input: {
  compositionId: string
  report: ComposeProgress
  heartbeat: () => Promise<void>
  signal: AbortSignal
  dependencies?: ComposeDependencies
}): Promise<{ durationMs: number; bytes: number }> {
  const db = getPrisma()
  const storage = input.dependencies?.storage ?? (await createStorageProvider())

  const composition = await db.videoComposition.findUnique({
    where: { id: input.compositionId },
    select: {
      id: true,
      projectId: true,
      width: true,
      height: true,
      fps: true,
      loudnessTarget: true,
      clips: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          trimInMs: true,
          trimOutMs: true,
          transition: true,
          transitionMs: true,
          speed: true,
          video: { select: { id: true, url: true } },
        },
      },
      audio: {
        orderBy: { createdAt: "asc" },
        select: { url: true, gainDb: true, startMs: true, kind: true },
      },
    },
  })

  if (!composition) throw new ComposeError("COMPOSITION_NOT_FOUND")
  if (composition.clips.length === 0) throw new ComposeError("COMPOSITION_REQUIRES_A_CLIP")

  const missing = composition.clips.filter((clip) => !clip.video.url)
  if (missing.length > 0) throw new ComposeError("CLIP_SOURCE_UNAVAILABLE", `${missing.length} clip(s)`)

  await db.videoComposition.update({
    where: { id: composition.id },
    data: { status: "RENDERING", safeErrorCode: null },
  })

  const workspace = await createRenderWorkspace()

  try {
    await input.report(2, "Gathering the clips")

    const clips: GraphClip[] = []
    for (const [index, clip] of composition.clips.entries()) {
      // A crawl-length lease is not enough for a render; the lease is extended at
      // every step that can take tens of seconds on its own.
      await input.heartbeat()

      const path = await workspace.fetch({
        url: clip.video.url!,
        name: workspaceName(clip.video.url!, index),
        signal: input.signal,
      })
      const probe = await probeVideo(path, input.signal)
      if (probe.durationMs <= 0) throw new ComposeError("CLIP_SOURCE_UNREADABLE", `clip ${index + 1}`)

      clips.push({
        path,
        trimInMs: clip.trimInMs,
        // A trim point past the end of the file becomes the end of the file. The
        // editor works from the provider's claimed length, which can be longer than
        // what arrived.
        trimOutMs: clip.trimOutMs === null ? null : Math.min(clip.trimOutMs, probe.durationMs),
        sourceDurationMs: probe.durationMs,
        speed: clip.speed,
        transition: clip.transition,
        transitionMs: clip.transitionMs,
        hasAudio: probe.hasAudio,
      })

      await input.report(
        Math.round(((index + 1) / composition.clips.length) * FETCH_SHARE * 100),
        `Gathering clip ${index + 1} of ${composition.clips.length}`,
      )
    }

    const beds = []
    for (const [index, track] of composition.audio.entries()) {
      await input.heartbeat()
      beds.push({
        path: await workspace.fetch({
          url: track.url,
          name: `bed-${index}.m4a`,
          signal: input.signal,
        }),
        gainDb: track.gainDb,
        startMs: track.startMs,
        // Music covers the whole edit; a voiceover is a fixed take and looping it
        // would repeat words.
        loop: track.kind === "MUSIC",
      })
    }

    const outputPath = workspace.path("master.mp4")
    const plan = buildCompositionGraph({
      clips,
      canvas: {
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        loudnessTarget: composition.loudnessTarget,
      },
      audio: beds,
      outputPath,
      threads: input.dependencies?.threads ?? defaultThreads(),
    })

    await input.report(Math.round(FETCH_SHARE * 100), "Cutting the edit")

    let lastHeartbeat = Date.now()
    await runFfmpeg({
      args: plan.args,
      durationMs: plan.durationMs,
      signal: input.signal,
      onProgress: (progress) => {
        if (progress.fraction === null) return
        const percent = Math.round((FETCH_SHARE + progress.fraction * ENCODE_SHARE) * 100)
        // `report` is throttled, so calling it on every frame is safe; the heartbeat
        // is not, and skipping it would let the lease expire mid-encode and hand the
        // job to a second worker.
        void input.report(percent, "Cutting the edit")
        if (Date.now() - lastHeartbeat > 30_000) {
          lastHeartbeat = Date.now()
          void input.heartbeat()
        }
      },
    })

    await input.report(92, "Checking the result")
    const rendered = await probeVideo(outputPath, input.signal)

    if (Math.abs(rendered.durationMs - plan.durationMs) > DURATION_TOLERANCE_MS) {
      // ffmpeg exited zero, so it wrote a file. That is not the same as writing the
      // edit that was asked for, and a silently short render is worse than a failure.
      throw new ComposeError(
        "COMPOSITION_DURATION_MISMATCH",
        `planned ${plan.durationMs}ms, rendered ${rendered.durationMs}ms`,
      )
    }

    const posterPath = workspace.path("poster.jpg")
    await runFfmpeg({
      args: buildPosterArgs({
        sourcePath: outputPath,
        outputPath: posterPath,
        // A third of the way in, past any fade from black at the top.
        atMs: Math.floor(rendered.durationMs / 3),
        width: composition.width,
        height: composition.height,
      }),
      signal: input.signal,
      timeoutMs: 60_000,
    })

    await input.report(95, "Saving")
    await input.heartbeat()

    const master = await workspace.read("master.mp4")
    const storageKey = `compositions/${composition.projectId}/${composition.id}/master.mp4`
    const stored = await storage.put({ key: storageKey, bytes: master.bytes, contentType: "video/mp4" })

    const poster = await workspace.read("poster.jpg")
    const posterKey = `compositions/${composition.projectId}/${composition.id}/poster.jpg`
    const storedPoster = await storage.put({ key: posterKey, bytes: poster.bytes, contentType: "image/jpeg" })

    await db.videoComposition.update({
      where: { id: composition.id },
      data: {
        status: "COMPLETED",
        durationMs: rendered.durationMs,
        storageKey,
        url: stored.url,
        posterKey,
        posterUrl: storedPoster.url,
        checksum: master.checksum,
        renderedAt: new Date(),
        safeErrorCode: null,
      },
    })

    await input.report(100, "Edit ready")
    return { durationMs: rendered.durationMs, bytes: master.size }
  } finally {
    // Hundreds of megabytes per render. A worker that leaks this fills the disk in a
    // few hundred jobs.
    await workspace.dispose()
  }
}

export async function renderCompositionExport(input: {
  compositionId: string
  preset: string
  report: ComposeProgress
  heartbeat: () => Promise<void>
  signal: AbortSignal
  dependencies?: ComposeDependencies
}): Promise<{ bytes: number; durationMs: number }> {
  const db = getPrisma()
  const storage = input.dependencies?.storage ?? (await createStorageProvider())

  const preset = findPreset(input.preset)
  if (!preset) throw new ComposeError("UNKNOWN_EXPORT_PRESET", input.preset)

  const composition = await db.videoComposition.findUnique({
    where: { id: input.compositionId },
    select: {
      id: true,
      projectId: true,
      width: true,
      height: true,
      fps: true,
      url: true,
      durationMs: true,
      status: true,
    },
  })
  if (!composition) throw new ComposeError("COMPOSITION_NOT_FOUND")
  if (composition.status !== "COMPLETED" || !composition.url) {
    throw new ComposeError("COMPOSITION_NOT_RENDERED")
  }

  await db.compositionRender.updateMany({
    where: { compositionId: composition.id, preset: preset.key },
    data: { status: "RENDERING", safeErrorCode: null },
  })

  const workspace = await createRenderWorkspace("adcrevia-export-")

  try {
    await input.report(5, `Preparing ${preset.label}`)
    const sourcePath = await workspace.fetch({
      url: composition.url,
      name: "master.mp4",
      signal: input.signal,
    })

    const outputPath = workspace.path(`${preset.key}.mp4`)
    const fit = chooseFit({ width: composition.width, height: composition.height }, preset)

    const plan = buildExportGraph({
      sourcePath,
      outputPath,
      width: preset.width,
      height: preset.height,
      fps: composition.fps,
      fit,
      maxrateKbps: preset.maxrateKbps,
      threads: input.dependencies?.threads ?? defaultThreads(),
    })

    await input.report(20, `Encoding for ${preset.label}`)
    let lastHeartbeat = Date.now()
    await runFfmpeg({
      args: plan.args,
      durationMs: composition.durationMs ?? undefined,
      signal: input.signal,
      onProgress: (progress) => {
        if (progress.fraction === null) return
        void input.report(20 + Math.round(progress.fraction * 65), `Encoding for ${preset.label}`)
        if (Date.now() - lastHeartbeat > 30_000) {
          lastHeartbeat = Date.now()
          void input.heartbeat()
        }
      },
    })

    const rendered = await probeVideo(outputPath, input.signal)

    const posterPath = workspace.path("poster.jpg")
    await runFfmpeg({
      args: buildPosterArgs({
        sourcePath: outputPath,
        outputPath: posterPath,
        atMs: Math.floor(rendered.durationMs / 3),
        width: preset.width,
        height: preset.height,
      }),
      signal: input.signal,
      timeoutMs: 60_000,
    })

    await input.report(90, "Saving")
    const file = await workspace.read(`${preset.key}.mp4`)
    const storageKey = `compositions/${composition.projectId}/${composition.id}/${preset.key}.mp4`
    const stored = await storage.put({ key: storageKey, bytes: file.bytes, contentType: "video/mp4" })

    const poster = await workspace.read("poster.jpg")
    const posterKey = `compositions/${composition.projectId}/${composition.id}/${preset.key}-poster.jpg`
    const storedPoster = await storage.put({ key: posterKey, bytes: poster.bytes, contentType: "image/jpeg" })

    await db.compositionRender.updateMany({
      where: { compositionId: composition.id, preset: preset.key },
      data: {
        status: "COMPLETED",
        storageKey,
        url: stored.url,
        posterKey,
        posterUrl: storedPoster.url,
        bytes: file.size,
        durationMs: rendered.durationMs,
        completedAt: new Date(),
        safeErrorCode: null,
      },
    })

    await input.report(100, `${preset.label} ready`)
    return { bytes: file.size, durationMs: rendered.durationMs }
  } finally {
    await workspace.dispose()
  }
}

/** Translate a render failure into a code that is safe to show and useful to an operator. */
export function safeComposeCode(error: unknown): string {
  if (error instanceof ComposeError) return error.safeErrorCode
  if (error instanceof FfmpegError) return error.safeErrorCode
  if (error instanceof WorkspaceError) return error.safeErrorCode
  return "COMPOSITION_FAILED"
}

/**
 * Codes a retry cannot fix.
 *
 * A malformed source or an impossible graph fails identically every time, and each
 * attempt costs minutes of CPU on a host that has none spare. A missing binary is
 * permanent for a different reason: it needs an operator, not a retry.
 */
const PERMANENT_COMPOSE_CODES = new Set([
  "COMPOSITION_NOT_FOUND",
  "COMPOSITION_REQUIRES_A_CLIP",
  "COMPOSITION_NOT_RENDERED",
  "UNKNOWN_EXPORT_PRESET",
  "CLIP_SOURCE_UNAVAILABLE",
  "CLIP_SOURCE_UNREADABLE",
  "SOURCE_TOO_LARGE",
  "FFMPEG_NOT_INSTALLED",
  "FFPROBE_NOT_INSTALLED",
  "FFPROBE_NO_VIDEO_STREAM",
  "INVALID_WORKSPACE_PATH",
])

export function isPermanentComposeCode(code: string): boolean {
  return PERMANENT_COMPOSE_CODES.has(code)
}

/**
 * Threads for x264.
 *
 * Half the worker's concurrency budget rather than the machine's core count. The host
 * runs the web process and two unrelated stacks on four shared cores, and ffmpeg will
 * use everything it is offered.
 */
function defaultThreads(): number {
  const configured = Number(process.env.FFMPEG_THREADS ?? "")
  if (Number.isFinite(configured) && configured >= 1) return Math.min(8, Math.floor(configured))
  return 2
}
