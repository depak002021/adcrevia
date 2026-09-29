import { z } from "zod"

import { MASTER_ASPECTS, SOCIAL_PRESETS } from "@/lib/video/presets"

/**
 * What a client may send about an edit.
 *
 * Bounds here are not defensive decoration. `transitionMs` reaches an ffmpeg filter
 * argument, `speed` reaches `atempo`, and a clip count reaches the number of
 * simultaneously open inputs in a filter graph — each one has a real limit, and
 * exceeding it produces an unhelpful ffmpeg error minutes into a render rather than a
 * 400 the user can act on.
 */

const masterAspects = MASTER_ASPECTS.map((entry) => entry.aspectRatio) as [string, ...string[]]
const presetKeys = SOCIAL_PRESETS.map((preset) => preset.key) as [string, ...string[]]

export const clipTransitions = ["NONE", "CROSSFADE", "FADE_BLACK", "DISSOLVE", "WIPE_LEFT", "WIPE_RIGHT"] as const

/** Matches `MAX_SELECTION` in the image tray: an edit is built from the selection. */
const MAX_CLIPS = 10

export const compositionClipInput = z.object({
  videoId: z.string().cuid(),
  trimInMs: z.number().int().min(0).max(10 * 60_000).default(0),
  trimOutMs: z.number().int().min(0).max(10 * 60_000).nullable().default(null),
  transition: z.enum(clipTransitions).default("CROSSFADE"),
  /**
   * Up to two seconds. Longer than that and a short clip is more transition than
   * picture; the graph clamps it to half the shorter neighbour anyway.
   */
  transitionMs: z.number().int().min(0).max(2_000).default(500),
  // `atempo` handles 0.5 to 2 in a single pass. Beyond it the audio degrades audibly.
  speed: z.number().min(0.5).max(2).default(1),
})

export const compositionInput = z.object({
  projectId: z.string().cuid(),
  aspectRatio: z.enum(masterAspects).default("9:16"),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).default(30),
  clips: z.array(compositionClipInput).min(1).max(MAX_CLIPS),
})

export const compositionUpdateInput = z.object({
  aspectRatio: z.enum(masterAspects).optional(),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).optional(),
  clips: z.array(compositionClipInput).min(1).max(MAX_CLIPS).optional(),
})

export const exportInput = z.object({
  presets: z.array(z.enum(presetKeys)).min(1).max(SOCIAL_PRESETS.length),
})

export type CompositionClipInput = z.infer<typeof compositionClipInput>
export type CompositionInput = z.infer<typeof compositionInput>
export type CompositionUpdateInput = z.infer<typeof compositionUpdateInput>

/**
 * Reject a trim window that is inverted or empty.
 *
 * Zod cannot express this on the object alone without a refinement per field pair, and
 * the failure is worth its own error code: a zero-length clip makes `xfade` read past
 * the end of a stream, which freezes a frame instead of failing.
 */
export function validateClipWindows(clips: CompositionClipInput[]): { ok: true } | { ok: false; reason: string } {
  for (const [index, clip] of clips.entries()) {
    if (clip.trimOutMs !== null && clip.trimOutMs <= clip.trimInMs) {
      return { ok: false, reason: `CLIP_${index + 1}_TRIM_WINDOW_EMPTY` }
    }
  }
  const seen = new Set<string>()
  for (const clip of clips) {
    // One appearance per source. The schema enforces it too
    // (`@@unique([compositionId, videoId])`), and a duplicate would otherwise fail
    // deep inside a transaction rather than here.
    if (seen.has(clip.videoId)) return { ok: false, reason: "CLIP_REPEATED" }
    seen.add(clip.videoId)
  }
  return { ok: true }
}
