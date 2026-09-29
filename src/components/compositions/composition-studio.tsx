"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { FilmSlate, ShareNetwork } from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"
import { Eyebrow } from "@/components/ui/eyebrow"
import { Progress, ProgressPulse } from "@/components/ui/progress"
import { Segmented } from "@/components/ui/segmented"
import { useToast } from "@/components/ui/toast"
import type { CompositionClipInput } from "@/features/compositions/schemas"
import {
  clampTrim,
  formatDuration,
  isDirty,
  moveClip,
  timelineDurationMs,
  type TimelineClip,
} from "@/features/compositions/timeline"
import type { ActivitySnapshot, CompositionSnapshot, VideoSnapshot } from "@/features/projects/snapshot"
import { MASTER_ASPECTS } from "@/lib/video/presets"
import { ClipRow } from "./clip-row"
import { ShareSheet } from "./share-sheet"

/**
 * The edit.
 *
 * One `GeneratedVideo` is one provider render, and until now there was no way to put
 * several together — no entity, no route, no encoder. This is the surface for that: an
 * ordered strip of clips, a shape to cut them to, and one render that every social
 * version is derived from.
 *
 * The duration on screen comes from the same functions the filter graph uses. Two
 * implementations of "clips minus overlaps" drift, and the symptom is somebody arranging
 * a 15-second edit and getting 14.2 back.
 *
 * Progress while rendering is the worker's own, over the project event stream. An encode
 * is minutes long on a shared host, so this is the screen where an invented progress bar
 * would do the most damage.
 */

type AspectValue = (typeof MASTER_ASPECTS)[number]["aspectRatio"]

const ASPECT_OPTIONS = MASTER_ASPECTS.map((entry) => ({
  value: entry.aspectRatio,
  label: entry.label,
}))

export function CompositionStudio({
  projectId,
  videos,
  compositions,
  activity,
  onQueued,
}: {
  projectId: string
  videos: VideoSnapshot[]
  compositions: CompositionSnapshot[]
  activity: ActivitySnapshot | null
  /** Called after any job is queued, so the caller can open the event stream. */
  onQueued: () => void
}) {
  const toast = useToast()

  const sources = useMemo(
    () => videos.filter((video) => video.status === "COMPLETED" && video.url),
    [videos],
  )
  const composition = compositions[0] ?? null

  const [clips, setClips] = useState<TimelineClip[] | null>(null)
  const [saved, setSaved] = useState<TimelineClip[] | null>(null)
  const [aspect, setAspect] = useState<AspectValue>(composition?.aspectRatio ?? "9:16")
  const [fps] = useState(30)
  const [pending, setPending] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  const rendering = composition?.status === "QUEUED" || composition?.status === "RENDERING"
  const encoding = activity?.kind === "VIDEO_COMPOSE" || activity?.kind === "VIDEO_EXPORT"

  /**
   * Load the arrangement once per composition.
   *
   * Not on every snapshot frame: the stream re-reads the project every second while work
   * is in flight, and replacing local state from it would yank a trim handle out of the
   * user's fingers.
   */
  useEffect(() => {
    if (!composition) {
      setClips(null)
      setSaved(null)
      return
    }
    let cancelled = false
    fetch(`/api/compositions/${composition.id}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body: { composition?: { aspectRatio: string; clips: ServerClip[] } }) => {
        if (cancelled || !body.composition) return
        const loaded = body.composition.clips.map(toTimelineClip)
        setClips(loaded)
        setSaved(loaded)
        setAspect(body.composition.aspectRatio as AspectValue)
      })
      .catch(() => {
        if (!cancelled) toast({ tone: "error", title: "Could not load the timeline" })
      })
    return () => {
      cancelled = true
    }
    // Keyed on the id alone, deliberately. See above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition?.id])

  const posterFor = useCallback(
    // The clip's source frame: an image tag cannot show an MP4.
    (videoId: string) => videos.find((video) => video.id === videoId)?.posterUrl ?? null,
    [videos],
  )

  const post = useCallback(
    async (path: string, body?: unknown, method: "POST" | "PATCH" = "POST") => {
      const response = await fetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? "That did not go through.")
      return payload
    },
    [],
  )

  const run = async (key: string, work: () => Promise<unknown>) => {
    setPending(key)
    try {
      await work()
      onQueued()
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not do that",
        description: error instanceof Error ? error.message : undefined,
      })
      throw error
    } finally {
      setPending(null)
    }
  }

  const createFromSources = () =>
    run("create", async () => {
      await post("/api/compositions", {
        projectId,
        aspectRatio: aspect,
        fps,
        clips: sources.map((video, index) => ({
          videoId: video.id,
          // Cut on the last clip; cross-fade everywhere else. A fade out of the final
          // frame into nothing is a different decision and belongs to the user.
          transition: index === sources.length - 1 ? "NONE" : "CROSSFADE",
        })),
      })
    })

  const saveTimeline = () =>
    run("save", async () => {
      if (!composition || !clips) return
      await post(
        `/api/compositions/${composition.id}`,
        { aspectRatio: aspect, fps, clips: clips.map(toInput) },
        "PATCH",
      )
      setSaved(clips)
    })

  const render = () =>
    run("render", async () => {
      if (!composition || !clips) return
      // Saved first, unconditionally. Rendering an arrangement the server has not been
      // told about is the one failure here nobody would understand.
      if (isDirty(clips, saved ?? [])) {
        await post(
          `/api/compositions/${composition.id}`,
          { aspectRatio: aspect, fps, clips: clips.map(toInput) },
          "PATCH",
        )
        setSaved(clips)
      }
      await post(`/api/compositions/${composition.id}/render`)
    })

  const exportTo = async (presets: string[]) => {
    if (!composition) return
    await run("export", () => post(`/api/compositions/${composition.id}/exports`, { presets }))
  }

  if (sources.length === 0) {
    return (
      <section className="shell" aria-label="The edit">
        <div className="core flex flex-col gap-3 p-6">
          <Eyebrow>The edit</Eyebrow>
          <p className="max-w-[52ch] text-[0.92rem] leading-relaxed text-muted">
            Once you have a motion clip or two, they can be cut together here into one
            edit and encoded for each platform.
          </p>
        </div>
      </section>
    )
  }

  const dirty = Boolean(clips && saved && isDirty(clips, saved))
  const duration = clips ? timelineDurationMs(clips, fps) : 0

  return (
    <>
      <section className="shell" aria-label="The edit">
        <div className="core flex flex-col gap-6 p-5 sm:p-6">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Eyebrow>The edit</Eyebrow>
              <h2 className="mt-2 text-[1.35rem] leading-tight font-medium tracking-[-0.03em] text-fg">
                {composition?.status === "COMPLETED"
                  ? "Your edit is ready."
                  : `${sources.length} clip${sources.length === 1 ? "" : "s"} to cut together.`}
              </h2>
            </div>

            {clips ? (
              <p className="font-mono text-[0.78rem] tabular-nums text-muted">
                {formatDuration(duration)}
                <span className="text-faint"> · {aspect}</span>
              </p>
            ) : null}
          </header>

          {!composition ? (
            <div className="flex flex-col gap-4">
              <Segmented
                label="Shape"
                options={ASPECT_OPTIONS}
                value={aspect}
                onChange={(next) => setAspect(next as AspectValue)}
              />
              <div>
                <Button
                  variant="primary"
                  well
                  glyph="right"
                  busy={pending === "create"}
                  onClick={createFromSources}
                  leading={<FilmSlate size={15} weight="fill" aria-hidden="true" />}
                >
                  Build the edit
                </Button>
              </div>
            </div>
          ) : (
            <>
              {composition.status === "COMPLETED" && composition.url ? (
                <div className="overflow-hidden rounded-inner bg-ink-3">
                  {/*
                    `preload="metadata"` rather than `auto`: the poster and the duration
                    are enough to decide to press play, and pre-buffering a 1080p master
                    on a phone data plan is not a decision to make for somebody.
                  */}
                  <video
                    key={composition.url}
                    src={composition.url}
                    poster={composition.posterUrl ?? undefined}
                    controls
                    preload="metadata"
                    playsInline
                    className="mx-auto max-h-[60vh] w-auto"
                  />
                </div>
              ) : null}

              {/*
                Locked while a render is in flight: changing the shape resets the
                composition to DRAFT on the server, which would leave the running encode
                producing an output nothing describes.
              */}
              <Segmented
                label="Shape"
                options={
                  rendering
                    ? ASPECT_OPTIONS.map((option) => ({
                        ...option,
                        disabled: true,
                        disabledReason: "Finish the current render first.",
                      }))
                    : ASPECT_OPTIONS
                }
                value={aspect}
                onChange={(next) => setAspect(next as AspectValue)}
              />

              {clips ? (
                <ol className="flex flex-col gap-3" aria-label="Timeline">
                  {clips.map((clip, index) => (
                    <ClipRow
                      key={clip.videoId}
                      clip={clip}
                      index={index}
                      total={clips.length}
                      posterUrl={posterFor(clip.videoId)}
                      disabled={rendering}
                      onChange={(next) =>
                        setClips((current) =>
                          current?.map((entry, position) =>
                            position === index ? clampTrim(next) : entry,
                          ) ?? null,
                        )
                      }
                      onMove={(direction) => setClips((current) => (current ? moveClip(current, index, direction) : null))}
                      onRemove={() =>
                        setClips((current) => current?.filter((_, position) => position !== index) ?? null)
                      }
                    />
                  ))}
                </ol>
              ) : (
                <p className="text-[0.88rem] text-muted">Loading the timeline…</p>
              )}

              {encoding && activity ? (
                <div className="flex flex-col gap-2.5 rounded-inner bg-accent/5 px-4 py-3.5" aria-live="polite">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[0.88rem] text-fg">{activity.label}</span>
                    {activity.determinate ? (
                      <span className="font-mono text-[0.75rem] tabular-nums text-muted">
                        {activity.progress}%
                      </span>
                    ) : null}
                  </div>
                  {activity.determinate ? (
                    <Progress value={activity.progress} label={activity.label} />
                  ) : (
                    <ProgressPulse label={activity.label} />
                  )}
                </div>
              ) : null}

              {composition.status === "FAILED" ? (
                <p className="rounded-inner bg-red-500/8 px-4 py-3 text-[0.86rem] text-red-200">
                  That render did not finish. Adjust the timeline and try again.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  well
                  glyph="right"
                  busy={pending === "render"}
                  disabled={rendering || !clips || clips.length === 0}
                  onClick={render}
                >
                  {composition.status === "COMPLETED" ? "Render again" : "Render the edit"}
                </Button>

                {dirty && !rendering ? (
                  <Button variant="secondary" busy={pending === "save"} onClick={saveTimeline}>
                    Save changes
                  </Button>
                ) : null}

                {composition.status === "COMPLETED" && composition.url ? (
                  <Button
                    variant="secondary"
                    onClick={() => setShareOpen(true)}
                    leading={<ShareNetwork size={15} weight="light" aria-hidden="true" />}
                  >
                    Share
                  </Button>
                ) : null}
              </div>

              {dirty && composition.status === "COMPLETED" ? (
                <p className="text-[0.82rem] text-muted">
                  The timeline has changed since this was rendered.
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>

      {composition ? (
        <ShareSheet
          projectId={projectId}
          open={shareOpen}
          onOpenChange={setShareOpen}
          composition={composition}
          onExport={exportTo}
        />
      ) : null}
    </>
  )
}

type ServerClip = {
  videoId: string
  trimInMs: number
  trimOutMs: number | null
  transition: string
  transitionMs: number
  speed: number
  source: { durationSeconds: number | null }
}

function toTimelineClip(clip: ServerClip): TimelineClip {
  return {
    videoId: clip.videoId,
    trimInMs: clip.trimInMs,
    trimOutMs: clip.trimOutMs,
    transition: clip.transition as TimelineClip["transition"],
    transitionMs: clip.transitionMs,
    speed: clip.speed,
    // Falls back to five seconds when the provider reported no duration, which is what
    // every model in the catalogue returns by default. The renderer measures the real
    // file and clamps again, so a wrong guess here costs a handle position, not a render.
    sourceDurationMs: Math.round((clip.source.durationSeconds ?? 5) * 1000),
  }
}

function toInput(clip: TimelineClip): CompositionClipInput {
  const { sourceDurationMs: _ignored, ...input } = clip
  return input
}
