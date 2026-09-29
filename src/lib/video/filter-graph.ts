import type { ClipTransition } from "@/generated/prisma/enums"

/**
 * The filter graph.
 *
 * A pure function from an edit to an ffmpeg command line. Pure on purpose: this is
 * the part that is genuinely hard to get right and impossible to debug from a render
 * that came out wrong, so it is testable without ffmpeg, without files and without a
 * database.
 *
 * Four things here are not obvious and each one is a visible defect if it is missed:
 *
 *  - Every input is normalised before it is touched. `xfade` and `concat` both
 *    require identical width, height, pixel format, frame rate and sample aspect
 *    ratio; feed them two provider renders with different geometry and ffmpeg either
 *    refuses or silently produces a stretched result.
 *  - `xfade` joins exactly two streams, so N clips need N-1 chained joins, each with
 *    an `offset` measured from the start of the *accumulated* stream rather than from
 *    the start of the clip. Getting the accumulation wrong produces a video that is
 *    the right length with the transitions in the wrong places.
 *  - A hard cut between two clips generated from the same still image duplicates a
 *    frame at the seam, which reads as a stutter. One frame comes off the outgoing
 *    clip at every hard cut.
 *  - Audio has to be folded the same way as video or it drifts. `acrossfade`
 *    shortens by exactly the overlap, mirroring `xfade`; `concat` does not, mirroring
 *    a cut.
 */

/** Framing when a clip's shape does not match the canvas. */
export type Fit = "cover" | "contain"

export type GraphClip = {
  /** Absolute path to the source file on disk. */
  path: string
  /** Trim window into the source, milliseconds from the start of the file. */
  trimInMs: number
  /** Exclusive end of the trim window. Null means to the end of the file. */
  trimOutMs: number | null
  /** Source duration, milliseconds. Used when `trimOutMs` is null. */
  sourceDurationMs: number
  /** Playback rate. 1 is untouched. Clamped to what `atempo` can do. */
  speed: number
  /** The join FROM this clip TO the next. Ignored on the last clip. */
  transition: ClipTransition
  transitionMs: number
  /** Whether the source file carries an audio stream. */
  hasAudio: boolean
}

export type GraphAudioTrack = {
  path: string
  /** Gain applied before the mix, decibels. Negative sits it under the picture. */
  gainDb: number
  startMs: number
  /** Loop the bed to cover the whole edit rather than falling silent. */
  loop: boolean
}

export type GraphCanvas = {
  width: number
  height: number
  fps: number
  /** Integrated loudness target, LUFS. */
  loudnessTarget: number
}

export type GraphPlan = {
  /** Everything after the `ffmpeg` binary itself. */
  args: string[]
  /** What the output should measure, milliseconds. Used to validate the render. */
  durationMs: number
  /** Kept separately so a failed render can be diagnosed from the log. */
  filterGraph: string
}

/** `atempo` only handles this range in one pass; beyond it the result degrades. */
const MIN_SPEED = 0.5
const MAX_SPEED = 2

/** A transition shorter than this is a cut with extra steps. */
const MIN_TRANSITION_MS = 80

/** ffmpeg's `xfade` name for each transition we offer. */
const XFADE_TRANSITIONS: Partial<Record<ClipTransition, string>> = {
  CROSSFADE: "fade",
  DISSOLVE: "dissolve",
  FADE_BLACK: "fadeblack",
  WIPE_LEFT: "wipeleft",
  WIPE_RIGHT: "wiperight",
}

export function isCrossFade(transition: ClipTransition): boolean {
  return transition in XFADE_TRANSITIONS
}

/** Duration of one clip in the edit, after trim and speed. */
export function clipDurationMs(clip: GraphClip): number {
  const end = clip.trimOutMs ?? clip.sourceDurationMs
  const window = Math.max(0, end - Math.max(0, clip.trimInMs))
  return Math.round(window / clampSpeed(clip.speed))
}

/**
 * Effective overlap at the join after clip `index`.
 *
 * Bounded by both neighbours: an overlap longer than either clip would make `xfade`
 * read past the end of a stream, which produces a frozen frame rather than an error.
 * Half of the shorter clip is the practical ceiling.
 */
export function transitionMsAt(clips: GraphClip[], index: number): number {
  const clip = clips[index]
  const next = clips[index + 1]
  if (!clip || !next || !isCrossFade(clip.transition)) return 0

  const requested = Math.max(0, Math.round(clip.transitionMs))
  if (requested < MIN_TRANSITION_MS) return 0

  const ceiling = Math.floor(Math.min(clipDurationMs(clip), clipDurationMs(next)) / 2)
  return Math.max(0, Math.min(requested, ceiling))
}

/**
 * Total length of the edit.
 *
 * Cross-fades overlap, so they shorten it. Hard cuts lose a single frame each, for
 * the duplicate-frame reason above. Exposed so a caller can validate the rendered
 * file rather than trusting the render.
 */
export function plannedDurationMs(clips: GraphClip[], fps: number): number {
  const frameMs = 1000 / Math.max(1, fps)
  let total = 0
  clips.forEach((clip, index) => {
    total += clipDurationMs(clip)
    if (index === clips.length - 1) return
    const overlap = transitionMsAt(clips, index)
    total -= overlap > 0 ? overlap : frameMs
  })
  return Math.max(0, Math.round(total))
}

export type BuildInput = {
  clips: GraphClip[]
  canvas: GraphCanvas
  audio?: GraphAudioTrack[]
  outputPath: string
  /** Ceiling on the encoded video bitrate. */
  maxrateKbps?: number
  /** Constant Rate Factor. Lower is better quality and a larger file. */
  crf?: number
  /**
   * x264 speed/compression trade-off. The default is chosen for a host with four
   * shared cores: `medium` roughly doubles the CPU time of `veryfast` for a few
   * percent of file size on this kind of footage.
   */
  preset?: string
  /** Cap on the threads x264 may use, so a render cannot starve the web process. */
  threads?: number
}

export function buildCompositionGraph(input: BuildInput): GraphPlan {
  if (input.clips.length === 0) throw new Error("COMPOSITION_REQUIRES_A_CLIP")

  const { width, height, fps } = input.canvas
  const frameMs = 1000 / Math.max(1, fps)
  const filters: string[] = []
  const args: string[] = ["-hide_banner", "-nostdin", "-y"]

  // Inputs. `-ss` and `-t` before `-i` are input options: ffmpeg seeks and stops
  // reading rather than decoding the whole file and discarding most of it.
  input.clips.forEach((clip) => {
    const windowMs = (clip.trimOutMs ?? clip.sourceDurationMs) - Math.max(0, clip.trimInMs)
    if (clip.trimInMs > 0) args.push("-ss", seconds(clip.trimInMs))
    args.push("-t", seconds(Math.max(frameMs, windowMs)))
    args.push("-i", clip.path)
  })

  const beds = input.audio ?? []
  beds.forEach((track) => {
    // `-stream_loop -1` before the input repeats it; the mix is cut to the picture
    // by `-shortest`, so an infinite loop cannot run away.
    if (track.loop) args.push("-stream_loop", "-1")
    args.push("-i", track.path)
  })

  const clipsWithAudio = input.clips.filter((clip) => clip.hasAudio).length
  /** Is there anything to actually hear? Provider renders usually have no audio. */
  const hasRealAudio = clipsWithAudio > 0 || beds.length > 0

  /**
   * A silence source is needed in two different situations, and conflating them is
   * how a silent edit ends up with no audio stream at all:
   *
   *  - Some clips have audio and some do not, so the quiet ones need something to
   *    contribute to the fold.
   *  - Nothing has audio, in which case the output still gets a silent AAC track.
   *    An MP4 with no audio stream is legal but several platforms handle it badly,
   *    and a silent track costs about a kilobyte per minute.
   */
  const silenceIndex =
    !hasRealAudio || clipsWithAudio < input.clips.length ? input.clips.length + beds.length : null
  if (silenceIndex !== null) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000")
  }

  // Video normalisation, one chain per clip.
  input.clips.forEach((clip, index) => {
    const isLast = index === input.clips.length - 1
    const overlap = transitionMsAt(input.clips, index)
    // One frame off the outgoing side of every hard cut. Two clips generated from
    // the same still share their boundary frame, and the repeat reads as a hitch.
    const shaveMs = !isLast && overlap === 0 ? frameMs : 0

    const steps = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "setsar=1",
    ]
    const speed = clampSpeed(clip.speed)
    if (speed !== 1) steps.push(`setpts=PTS/${speed.toFixed(4)}`)
    steps.push(`fps=${fps}`, "format=yuv420p")
    if (shaveMs > 0) {
      // `trim` re-bases nothing, so `setpts` resets the stream to start at zero —
      // `xfade` and `concat` both expect that.
      steps.push(`trim=duration=${seconds(clipDurationMs(clip) - shaveMs)}`, "setpts=PTS-STARTPTS")
    }
    filters.push(`[${index}:v]${steps.join(",")}[v${index}]`)
  })

  // Audio normalisation, one chain per clip, mirroring the video. Skipped entirely
  // when there is nothing to hear: the lone silence input is mapped straight out
  // instead, which is a shorter graph and one less thing to be wrong.
  if (hasRealAudio) {
    let silenceTaps = 0
    input.clips.forEach((clip) => {
      if (!clip.hasAudio) silenceTaps += 1
    })
    if (silenceIndex !== null && silenceTaps > 1) {
      const labels = Array.from({ length: silenceTaps }, (_, tap) => `[sil${tap}]`).join("")
      filters.push(`[${silenceIndex}:a]asplit=${silenceTaps}${labels}`)
    }

    let tap = 0
    input.clips.forEach((clip, index) => {
      const isLast = index === input.clips.length - 1
      const overlap = transitionMsAt(input.clips, index)
      const target = clipDurationMs(clip) - (!isLast && overlap === 0 ? frameMs : 0)

      if (clip.hasAudio) {
        const steps = ["aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"]
        const speed = clampSpeed(clip.speed)
        if (speed !== 1) steps.push(`atempo=${speed.toFixed(4)}`)
        steps.push(`atrim=duration=${seconds(target)}`, "asetpts=N/SR/TB")
        filters.push(`[${index}:a]${steps.join(",")}[a${index}]`)
        return
      }

      const source = silenceTaps > 1 ? `[sil${tap}]` : `[${silenceIndex}:a]`
      tap += 1
      filters.push(
        `${source}atrim=duration=${seconds(target)},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=N/SR/TB[a${index}]`,
      )
    })
  }

  // Fold the clips together, left to right, tracking where the accumulated stream
  // ends so each `xfade` offset can be measured from it.
  let videoLabel = "v0"
  let audioLabel = hasRealAudio ? "a0" : null
  let accumulatedMs = clipDurationMs(input.clips[0])
  if (input.clips.length > 1 && transitionMsAt(input.clips, 0) === 0) accumulatedMs -= frameMs

  for (let index = 0; index < input.clips.length - 1; index += 1) {
    const overlap = transitionMsAt(input.clips, index)
    const right = input.clips[index + 1]
    const rightIsLast = index + 1 === input.clips.length - 1
    const rightOverlap = transitionMsAt(input.clips, index + 1)
    const rightDuration = clipDurationMs(right) - (!rightIsLast && rightOverlap === 0 ? frameMs : 0)

    const outVideo = `vx${index}`
    if (overlap > 0) {
      const name = XFADE_TRANSITIONS[input.clips[index].transition] ?? "fade"
      // `offset` is where the overlap begins in the ACCUMULATED stream, not in the
      // outgoing clip. Measuring it from the clip is the classic mistake and puts
      // every transition after the first in the wrong place.
      const offsetMs = Math.max(0, accumulatedMs - overlap)
      filters.push(
        `[${videoLabel}][v${index + 1}]xfade=transition=${name}:duration=${seconds(overlap)}:offset=${seconds(offsetMs)}[${outVideo}]`,
      )
      accumulatedMs = accumulatedMs + rightDuration - overlap
    } else {
      filters.push(`[${videoLabel}][v${index + 1}]concat=n=2:v=1:a=0[${outVideo}]`)
      accumulatedMs = accumulatedMs + rightDuration
    }
    videoLabel = outVideo

    if (audioLabel) {
      const outAudio = `ax${index}`
      if (overlap > 0) {
        // `acrossfade` shortens by exactly the overlap, which is what keeps the
        // audio aligned with an `xfade` on the picture.
        filters.push(
          `[${audioLabel}][a${index + 1}]acrossfade=d=${seconds(overlap)}:c1=tri:c2=tri[${outAudio}]`,
        )
      } else {
        filters.push(`[${audioLabel}][a${index + 1}]concat=n=2:v=0:a=1[${outAudio}]`)
      }
      audioLabel = outAudio
    }
  }

  const durationMs = plannedDurationMs(input.clips, fps)

  // Music and voiceover on top of the clip audio.
  if (audioLabel && beds.length > 0) {
    const bedLabels: string[] = []
    beds.forEach((track, bedIndex) => {
      const inputIndex = input.clips.length + bedIndex
      const steps = ["aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"]
      if (track.startMs > 0) steps.push(`adelay=${Math.round(track.startMs)}|${Math.round(track.startMs)}`)
      steps.push(`volume=${track.gainDb.toFixed(2)}dB`, `atrim=duration=${seconds(durationMs)}`, "asetpts=N/SR/TB")
      filters.push(`[${inputIndex}:a]${steps.join(",")}[bed${bedIndex}]`)
      bedLabels.push(`[bed${bedIndex}]`)
    })
    // `dropout_transition=0` stops amix raising the gain of the survivors when one
    // input ends, which otherwise makes the bed jump as the edit finishes.
    filters.push(
      `[${audioLabel}]${bedLabels.join("")}amix=inputs=${beds.length + 1}:duration=first:dropout_transition=0:normalize=0[amixed]`,
    )
    audioLabel = "amixed"
  }

  // Master to the level the platforms normalise to, so they leave it alone.
  if (audioLabel) {
    filters.push(
      `[${audioLabel}]loudnorm=I=${input.canvas.loudnessTarget}:TP=-1.5:LRA=11[aout]`,
    )
    audioLabel = "aout"
  }

  const filterGraph = filters.join(";")
  args.push("-filter_complex", filterGraph)
  args.push("-map", `[${videoLabel}]`)

  if (audioLabel) {
    args.push("-map", `[${audioLabel}]`)
  } else if (silenceIndex !== null) {
    args.push("-map", `${silenceIndex}:a`)
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    input.preset ?? "veryfast",
    "-crf",
    String(input.crf ?? 20),
    // High profile at 4.1 is the widest-compatibility pair for 1080p H.264.
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    // A keyframe every second. Platforms re-encode, and frequent keyframes survive
    // that better than a long GOP.
    "-g",
    String(Math.max(1, Math.round(fps))),
    "-maxrate",
    `${input.maxrateKbps ?? 6_000}k`,
    "-bufsize",
    `${(input.maxrateKbps ?? 6_000) * 2}k`,
    "-threads",
    String(input.threads ?? 2),
  )

  if (audioLabel || silenceIndex !== null) {
    args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2")
  }

  args.push(
    // Without `+faststart` the index sits at the end of the file and a browser has
    // to download all of it before the first frame.
    "-movflags",
    "+faststart",
    // Belt and braces against a looped bed or an off-by-one in the graph.
    "-t",
    seconds(durationMs),
    input.outputPath,
  )

  return { args, durationMs, filterGraph }
}

/**
 * Re-frame an already-rendered master for one destination.
 *
 * A second pass over the master rather than a second edit. Re-running the whole
 * graph per platform would multiply the CPU cost by the number of destinations on a
 * host that has none to spare, and it would risk the versions differing.
 */
export function buildExportGraph(input: {
  sourcePath: string
  outputPath: string
  width: number
  height: number
  fps: number
  fit: Fit
  maxrateKbps: number
  crf?: number
  preset?: string
  threads?: number
}): GraphPlan {
  const { width, height, fit } = input

  const steps =
    fit === "cover"
      ? [
          // Scale so the shorter side fills, then take the centre.
          `scale=${width}:${height}:force_original_aspect_ratio=increase`,
          `crop=${width}:${height}`,
        ]
      : [
          `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
        ]
  steps.push("setsar=1", "format=yuv420p")

  const filterGraph = `[0:v]${steps.join(",")}[vout]`

  return {
    filterGraph,
    durationMs: 0,
    args: [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      input.sourcePath,
      "-filter_complex",
      filterGraph,
      "-map",
      "[vout]",
      // `?` makes the audio mapping optional, so a silent master does not fail here.
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      input.preset ?? "veryfast",
      "-crf",
      String(input.crf ?? 21),
      "-profile:v",
      "high",
      "-level",
      "4.1",
      "-pix_fmt",
      "yuv420p",
      "-g",
      String(Math.max(1, Math.round(input.fps))),
      "-maxrate",
      `${input.maxrateKbps}k`,
      "-bufsize",
      `${input.maxrateKbps * 2}k`,
      "-threads",
      String(input.threads ?? 2),
      // The master's audio is already at the loudness target; re-encoding it is
      // cheaper and safer than re-running loudnorm and shifting the level again.
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      input.outputPath,
    ],
  }
}

/** A single frame, for the poster image. */
export function buildPosterArgs(input: {
  sourcePath: string
  outputPath: string
  atMs: number
  width: number
  height: number
}): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    // Seeking before the input is orders of magnitude faster and is accurate enough
    // for a thumbnail.
    "-ss",
    seconds(Math.max(0, input.atMs)),
    "-i",
    input.sourcePath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease`,
    "-f",
    "image2",
    "-c:v",
    "mjpeg",
    "-q:v",
    "3",
    input.outputPath,
  ]
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
}

/** Milliseconds as seconds with millisecond precision, which is what ffmpeg reads. */
function seconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3)
}
