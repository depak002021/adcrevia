import { clipDurationMs, plannedDurationMs, type GraphClip } from "@/lib/video/filter-graph"

import type { CompositionClipInput } from "./schemas"

/**
 * Timeline arithmetic shared by the editor and the renderer.
 *
 * Deliberately the same functions the filter graph uses. The duration the editor shows
 * while somebody drags a trim handle and the duration ffmpeg actually produces have to
 * be the same number — two implementations of "clips minus overlaps" drift, and the
 * symptom is a user who arranges a 15-second edit and gets 14.2.
 *
 * `filter-graph` is pure and imports nothing but a type, so it is safe in a client
 * component. That is why the maths lives there rather than being duplicated here.
 */

export type TimelineClip = CompositionClipInput & {
  /** Length of the source render, milliseconds. The trim window's ceiling. */
  sourceDurationMs: number
}

/** Shape the graph functions expect. Paths and audio are irrelevant to duration. */
function asGraphClip(clip: TimelineClip): GraphClip {
  return {
    path: "",
    trimInMs: clip.trimInMs,
    trimOutMs: clip.trimOutMs,
    sourceDurationMs: clip.sourceDurationMs,
    speed: clip.speed,
    transition: clip.transition,
    transitionMs: clip.transitionMs,
    hasAudio: false,
  }
}

export function timelineClipDurationMs(clip: TimelineClip): number {
  return clipDurationMs(asGraphClip(clip))
}

export function timelineDurationMs(clips: TimelineClip[], fps: number): number {
  return plannedDurationMs(clips.map(asGraphClip), fps)
}

/** `12.4s`, or `1:04.2` once it is past a minute. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, ms) / 1000
  if (total < 60) return `${total.toFixed(1)}s`
  const minutes = Math.floor(total / 60)
  const seconds = total - minutes * 60
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`
}

/** `4.2 MB`. Rendered files are megabytes, so a byte count is noise. */
export function formatBytes(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null
  const mb = bytes / (1024 * 1024)
  return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`
}

/**
 * Move a clip one place in either direction.
 *
 * Arrow buttons rather than only drag-and-drop: reordering has to work with a keyboard
 * and with a screen reader, and a pointer-only timeline is unusable for anyone who
 * cannot make a precise drag.
 */
export function moveClip<T>(clips: T[], from: number, direction: -1 | 1): T[] {
  const to = from + direction
  if (from < 0 || from >= clips.length || to < 0 || to >= clips.length) return clips
  const next = [...clips]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Clamp a trim window to the source.
 *
 * The editor works from the length the provider reported, which can be longer than the
 * file that actually arrived. The renderer clamps again against the probed duration;
 * this keeps the editor from offering a handle position that will silently move.
 */
export function clampTrim(clip: TimelineClip): TimelineClip {
  const trimInMs = Math.max(0, Math.min(clip.trimInMs, Math.max(0, clip.sourceDurationMs - 200)))
  const trimOutMs =
    clip.trimOutMs === null ? null : Math.max(trimInMs + 200, Math.min(clip.trimOutMs, clip.sourceDurationMs))
  return { ...clip, trimInMs, trimOutMs }
}

/** Does this arrangement differ from the one the server has? */
export function isDirty(current: TimelineClip[], saved: TimelineClip[]): boolean {
  if (current.length !== saved.length) return true
  return current.some((clip, index) => {
    const other = saved[index]
    return (
      clip.videoId !== other.videoId ||
      clip.trimInMs !== other.trimInMs ||
      clip.trimOutMs !== other.trimOutMs ||
      clip.transition !== other.transition ||
      clip.transitionMs !== other.transitionMs ||
      clip.speed !== other.speed
    )
  })
}
