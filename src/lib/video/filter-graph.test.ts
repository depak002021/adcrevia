import { describe, expect, it } from "vitest"

import {
  buildCompositionGraph,
  buildExportGraph,
  buildPosterArgs,
  clipDurationMs,
  plannedDurationMs,
  transitionMsAt,
  type GraphClip,
} from "./filter-graph"

/**
 * The filter graph cannot be debugged from a render that came out wrong, so it is
 * pinned here as a string. Most of these assertions exist because the failure mode is
 * silent: ffmpeg accepts the command, produces a file of roughly the right length, and
 * puts the transitions in the wrong places.
 */

const canvas = { width: 1080, height: 1920, fps: 30, loudnessTarget: -14 }

function clip(overrides: Partial<GraphClip> = {}): GraphClip {
  return {
    path: "/tmp/clip.mp4",
    trimInMs: 0,
    trimOutMs: null,
    sourceDurationMs: 5_000,
    speed: 1,
    transition: "CROSSFADE",
    transitionMs: 500,
    hasAudio: false,
    ...overrides,
  }
}

function build(clips: GraphClip[], extra: Partial<Parameters<typeof buildCompositionGraph>[0]> = {}) {
  return buildCompositionGraph({ clips, canvas, outputPath: "/tmp/out.mp4", ...extra })
}

describe("clipDurationMs", () => {
  it("measures the trim window rather than the whole file", () => {
    expect(clipDurationMs(clip({ trimInMs: 1_000, trimOutMs: 4_000 }))).toBe(3_000)
  })

  it("runs to the end of the source when there is no out point", () => {
    expect(clipDurationMs(clip({ trimInMs: 2_000, sourceDurationMs: 5_000 }))).toBe(3_000)
  })

  it("shortens with speed", () => {
    expect(clipDurationMs(clip({ sourceDurationMs: 4_000, speed: 2 }))).toBe(2_000)
  })

  it("clamps a speed beyond what atempo can do in one pass", () => {
    // 4x would need chained atempo stages; silently accepting it would desynchronise
    // the audio from the picture.
    expect(clipDurationMs(clip({ sourceDurationMs: 4_000, speed: 4 }))).toBe(2_000)
  })

  it("treats a nonsensical speed as untouched", () => {
    expect(clipDurationMs(clip({ sourceDurationMs: 4_000, speed: 0 }))).toBe(4_000)
    expect(clipDurationMs(clip({ sourceDurationMs: 4_000, speed: Number.NaN }))).toBe(4_000)
  })
})

describe("transitionMsAt", () => {
  it("is zero on the last clip, which has nothing to join to", () => {
    expect(transitionMsAt([clip(), clip()], 1)).toBe(0)
  })

  it("is zero for a hard cut", () => {
    expect(transitionMsAt([clip({ transition: "NONE" }), clip()], 0)).toBe(0)
  })

  it("caps the overlap at half of the shorter neighbour", () => {
    // An overlap longer than a clip makes xfade read past the end of the stream,
    // which freezes a frame instead of failing.
    const clips = [clip({ sourceDurationMs: 1_000, transitionMs: 5_000 }), clip()]
    expect(transitionMsAt(clips, 0)).toBe(500)
  })

  it("treats an absurdly short transition as a cut", () => {
    expect(transitionMsAt([clip({ transitionMs: 10 }), clip()], 0)).toBe(0)
  })
})

describe("plannedDurationMs", () => {
  it("subtracts every overlap", () => {
    // 3 x 5000 with 2 x 500 of overlap.
    expect(plannedDurationMs([clip(), clip(), clip()], 30)).toBe(14_000)
  })

  it("loses one frame per hard cut", () => {
    // Two clips generated from the same still share their boundary frame; the repeat
    // reads as a hitch, so one frame comes off the outgoing side.
    const clips = [clip({ transition: "NONE" }), clip({ transition: "NONE" }), clip()]
    expect(plannedDurationMs(clips, 30)).toBe(15_000 - Math.round((1000 / 30) * 2))
  })

  it("is just the clip for a single-clip edit", () => {
    expect(plannedDurationMs([clip()], 30)).toBe(5_000)
  })
})

describe("buildCompositionGraph", () => {
  it("refuses an empty edit", () => {
    expect(() => build([])).toThrow("COMPOSITION_REQUIRES_A_CLIP")
  })

  it("normalises every input before joining them", () => {
    const { filterGraph } = build([clip(), clip()])
    // xfade and concat both demand identical geometry, pixel format, frame rate and
    // sample aspect ratio. Without this ffmpeg either refuses or stretches a clip.
    expect(filterGraph).toContain(
      "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p[v0]",
    )
    expect(filterGraph).toContain("[1:v]scale=1080:1920")
  })

  it("seeks and limits on the input rather than decoding the whole file", () => {
    const { args } = build([clip({ trimInMs: 1_500, trimOutMs: 3_500 })])
    const seek = args.indexOf("-ss")
    expect(args[seek + 1]).toBe("1.500")
    expect(args[args.indexOf("-t")]).toBe("-t")
    // `-ss` and `-t` must come before `-i` to be input options.
    expect(seek).toBeLessThan(args.indexOf("-i"))
    expect(args[args.indexOf("-t") + 1]).toBe("2.000")
  })

  it("measures each xfade offset from the accumulated stream, not from the clip", () => {
    const { filterGraph } = build([clip(), clip(), clip()])

    // First join: 5000 - 500.
    expect(filterGraph).toContain("xfade=transition=fade:duration=0.500:offset=4.500[vx0]")
    // Second join: the merged stream is 9500 long, so the overlap starts at 9000.
    // Measuring from the clip would put it at 4.500 again and stack both
    // transitions at the front of the video.
    expect(filterGraph).toContain("xfade=transition=fade:duration=0.500:offset=9.000[vx1]")
  })

  it("chains N-1 joins for N clips", () => {
    const { filterGraph } = build([clip(), clip(), clip(), clip()])
    expect(filterGraph.match(/xfade=/g)).toHaveLength(3)
  })

  it("uses concat for a hard cut rather than a one-frame dissolve", () => {
    const { filterGraph } = build([clip({ transition: "NONE" }), clip()])
    expect(filterGraph).toContain("concat=n=2:v=1:a=0[vx0]")
    expect(filterGraph).not.toContain("xfade")
  })

  it("shaves a frame off the outgoing side of a hard cut", () => {
    const { filterGraph } = build([clip({ transition: "NONE" }), clip()])
    // 5000 - 33.33ms, and setpts re-bases the stream so concat still sees zero.
    expect(filterGraph).toContain("trim=duration=4.967,setpts=PTS-STARTPTS[v0]")
  })

  it("does not shave the final clip, which joins to nothing", () => {
    const { filterGraph } = build([clip({ transition: "NONE" }), clip()])
    expect(filterGraph).not.toContain("[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,trim")
  })

  it("mixes hard cuts and cross-fades in one graph", () => {
    const { filterGraph } = build([clip({ transition: "NONE" }), clip({ transition: "CROSSFADE" }), clip()])
    expect(filterGraph).toContain("concat=n=2:v=1:a=0[vx0]")
    expect(filterGraph).toContain("xfade=transition=fade")
  })

  it("maps each transition to its ffmpeg name", () => {
    for (const [transition, name] of [
      ["DISSOLVE", "dissolve"],
      ["FADE_BLACK", "fadeblack"],
      ["WIPE_LEFT", "wipeleft"],
      ["WIPE_RIGHT", "wiperight"],
    ] as const) {
      const { filterGraph } = build([clip({ transition }), clip()])
      expect(filterGraph).toContain(`xfade=transition=${name}`)
    }
  })

  it("applies speed before resampling the frame rate", () => {
    const { filterGraph } = build([clip({ speed: 1.5 })])
    // setpts works on the source timebase; running fps first would resample twice.
    expect(filterGraph).toContain("setsar=1,setpts=PTS/1.5000,fps=30")
  })

  it("adds a silent track for clips with no audio of their own", () => {
    const { args, filterGraph } = build([clip(), clip()])
    // Provider renders usually have no audio, so this is the normal case.
    expect(args).toContain("anullsrc=channel_layout=stereo:sample_rate=48000")
    // Video-only, so no audio filter chain: the silence is mapped straight out.
    expect(filterGraph).not.toContain("acrossfade")
    expect(args.join(" ")).toContain("-map 2:a")
  })

  it("folds real clip audio with the same shape as the picture", () => {
    const { filterGraph } = build([clip({ hasAudio: true }), clip({ hasAudio: true })])
    // acrossfade shortens by exactly the overlap, which is what keeps audio aligned
    // with an xfade. concat would leave it half a second long.
    expect(filterGraph).toContain("acrossfade=d=0.500:c1=tri:c2=tri[ax0]")
  })

  it("splits one silence source when several clips need it", () => {
    const { filterGraph } = build([clip({ hasAudio: true }), clip(), clip()])
    expect(filterGraph).toContain("asplit=2[sil0][sil1]")
  })

  it("trims silence to the same length as the clip it stands in for", () => {
    const { filterGraph } = build([clip({ hasAudio: true }), clip({ sourceDurationMs: 3_000 })])
    expect(filterGraph).toContain("atrim=duration=3.000")
  })

  it("mixes a music bed under the clip audio and masters the result", () => {
    const { args, filterGraph } = build([clip({ hasAudio: true }), clip({ hasAudio: true })], {
      audio: [{ path: "/tmp/bed.mp3", gainDb: -18, startMs: 0, loop: true }],
    })

    expect(args).toContain("-stream_loop")
    expect(filterGraph).toContain("volume=-18.00dB")
    // `normalize=0` and `dropout_transition=0` stop amix changing the gain as inputs
    // start and end, which otherwise makes the bed jump when the edit finishes.
    expect(filterGraph).toContain("amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed]")
    // -14 LUFS is what the platforms normalise to, so mastering to it means they
    // leave the level alone.
    expect(filterGraph).toContain("loudnorm=I=-14:TP=-1.5:LRA=11[aout]")
  })

  it("delays a bed that starts partway in", () => {
    const { filterGraph } = build([clip({ hasAudio: true })], {
      audio: [{ path: "/tmp/bed.mp3", gainDb: -12, startMs: 2_000, loop: false }],
    })
    expect(filterGraph).toContain("adelay=2000|2000")
  })

  it("encodes for the widest compatibility and for streaming", () => {
    const { args } = build([clip()])
    const flat = args.join(" ")
    expect(flat).toContain("-c:v libx264")
    expect(flat).toContain("-profile:v high -level 4.1")
    expect(flat).toContain("-pix_fmt yuv420p")
    expect(flat).toContain("-c:a aac")
    // Without +faststart the index sits at the end and a browser must download the
    // whole file before the first frame.
    expect(flat).toContain("-movflags +faststart")
  })

  it("caps threads so a render cannot starve the web process", () => {
    const { args } = build([clip()], { threads: 1 })
    expect(args[args.indexOf("-threads") + 1]).toBe("1")
  })

  it("cuts the output to the planned duration as a backstop", () => {
    const plan = build([clip(), clip()])
    // A looped bed or an off-by-one in the graph cannot lengthen the file.
    expect(plan.args.at(-3)).toBe("-t")
    expect(plan.args.at(-2)).toBe("9.500")
    expect(plan.durationMs).toBe(9_500)
  })

  it("still muxes a silent audio track when nothing has audio", () => {
    const { args, filterGraph } = build([clip()])
    // An MP4 with no audio stream at all is legal, and several platforms handle it
    // badly. A silent AAC track costs about a kilobyte a minute.
    expect(args).toContain("anullsrc=channel_layout=stereo:sample_rate=48000")
    expect(args.join(" ")).toContain("-map 1:a")
    expect(args.join(" ")).toContain("-c:a aac")
    // No audio filter chain for the silent case: a shorter graph is one less thing
    // that can be wrong.
    expect(filterGraph).not.toContain("loudnorm")
  })

  it("puts the output path last", () => {
    expect(build([clip()]).args.at(-1)).toBe("/tmp/out.mp4")
  })

  it("passes paths as separate argv entries, never interpolated into a string", () => {
    // Filter graphs contain `;` `[` `,` and quotes, and paths come from storage keys.
    // A shell anywhere in this is both a quoting nightmare and an injection risk.
    const { args } = build([clip({ path: "/tmp/a b;rm -rf .mp4" })])
    expect(args).toContain("/tmp/a b;rm -rf .mp4")
  })
})

describe("buildExportGraph", () => {
  const base = {
    sourcePath: "/tmp/master.mp4",
    outputPath: "/tmp/reels.mp4",
    width: 1080,
    height: 1080,
    fps: 30,
    maxrateKbps: 5_000,
  }

  it("crops to fill when told to cover", () => {
    const { filterGraph } = buildExportGraph({ ...base, fit: "cover" })
    expect(filterGraph).toBe(
      "[0:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,setsar=1,format=yuv420p[vout]",
    )
  })

  it("pads to fit when told to contain", () => {
    const { filterGraph } = buildExportGraph({ ...base, fit: "contain" })
    expect(filterGraph).toContain("force_original_aspect_ratio=decrease")
    expect(filterGraph).toContain("pad=1080:1080")
  })

  it("makes the audio mapping optional so a silent master still exports", () => {
    const { args } = buildExportGraph({ ...base, fit: "cover" })
    expect(args.join(" ")).toContain("-map 0:a?")
  })

  it("re-encodes the master rather than re-running the whole edit", () => {
    const { args } = buildExportGraph({ ...base, fit: "cover" })
    // One input. Re-running the graph per destination would multiply the CPU cost by
    // the number of platforms and risk the versions differing.
    expect(args.filter((arg) => arg === "-i")).toHaveLength(1)
    // No second loudnorm: the master is already at the target, and running it again
    // would shift the level.
    expect(args.join(" ")).not.toContain("loudnorm")
  })
})

describe("buildPosterArgs", () => {
  it("seeks before the input, which is what makes a thumbnail cheap", () => {
    const args = buildPosterArgs({
      sourcePath: "/tmp/master.mp4",
      outputPath: "/tmp/poster.jpg",
      atMs: 1_200,
      width: 1080,
      height: 1920,
    })
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"))
    expect(args[args.indexOf("-ss") + 1]).toBe("1.200")
    expect(args[args.indexOf("-frames:v") + 1]).toBe("1")
  })

  it("never seeks to a negative timestamp", () => {
    const args = buildPosterArgs({
      sourcePath: "/tmp/master.mp4",
      outputPath: "/tmp/poster.jpg",
      atMs: -500,
      width: 1080,
      height: 1920,
    })
    expect(args[args.indexOf("-ss") + 1]).toBe("0.000")
  })
})
