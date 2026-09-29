/**
 * Renders a real composition with the real filter graph.
 *
 * The graph builder is unit tested as a string, which catches the offset arithmetic
 * and the chain order but cannot tell you whether ffmpeg accepts the result. This
 * script closes that gap: it synthesises clips that differ in every way a provider's
 * renders differ — resolution, aspect, frame rate, presence of audio — folds them
 * with a mix of transitions, and then measures the output.
 *
 * Not a vitest test. It needs an ffmpeg binary, takes tens of seconds, and its value
 * is as a gate run deliberately before deploying rather than on every save.
 *
 * Usage:
 *   npx tsx scripts/verify-ffmpeg-graph.ts
 *
 * Needs `ffmpeg` and `ffprobe` on PATH, or FFMPEG_PATH / FFPROBE_PATH pointing at
 * them. The production image installs both through apt.
 */

import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildCompositionGraph,
  buildExportGraph,
  buildPosterArgs,
  plannedDurationMs,
  type GraphClip,
} from "../src/lib/video/filter-graph"
import { probeVideo, runFfmpeg } from "../src/lib/video/ffmpeg"
import { chooseFit } from "../src/lib/video/presets"

const canvas = { width: 1080, height: 1920, fps: 30, loudnessTarget: -14 }

/** How far the rendered duration may sit from the plan. One frame either way. */
const TOLERANCE_MS = 120

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []

function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}\n`)
}

async function main() {
  const workDir = await mkdtemp(join(tmpdir(), "adcrevia-ffmpeg-"))
  process.stdout.write(`work dir: ${workDir}\n\n`)

  try {
    process.stdout.write("synthesising sources\n")

    // Deliberately mismatched. A provider set is never uniform, and the whole point
    // of the normalisation chain is that this works.
    const sources = [
      { name: "a.mp4", size: "1280x720", fps: 24, seconds: 4, audio: false },
      { name: "b.mp4", size: "1080x1920", fps: 30, seconds: 5, audio: true },
      { name: "c.mp4", size: "1920x1080", fps: 25, seconds: 3, audio: false },
    ]

    for (const source of sources) {
      const args = [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=${source.size}:rate=${source.fps}:duration=${source.seconds}`,
      ]
      if (source.audio) {
        args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${source.seconds}:sample_rate=48000`)
      }
      args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p")
      if (source.audio) args.push("-c:a", "aac", "-shortest")
      args.push(join(workDir, source.name))
      await runFfmpeg({ args })
    }

    const probes = await Promise.all(sources.map((source) => probeVideo(join(workDir, source.name))))
    check(
      "sources differ in geometry, rate and audio, as provider renders do",
      new Set(probes.map((probe) => `${probe.width}x${probe.height}`)).size === 3 &&
        probes.filter((probe) => probe.hasAudio).length === 1,
      probes.map((probe) => `${probe.width}x${probe.height}@${probe.fps}${probe.hasAudio ? "+a" : ""}`).join(" "),
    )

    // ---------------------------------------------------------------- composition

    const clips: GraphClip[] = [
      {
        path: join(workDir, "a.mp4"),
        trimInMs: 0,
        trimOutMs: 3_000,
        sourceDurationMs: probes[0].durationMs,
        speed: 1,
        transition: "CROSSFADE",
        transitionMs: 600,
        hasAudio: probes[0].hasAudio,
      },
      {
        path: join(workDir, "b.mp4"),
        trimInMs: 500,
        trimOutMs: 4_500,
        sourceDurationMs: probes[1].durationMs,
        speed: 1,
        // A hard cut in the middle, so both join kinds are exercised in one graph.
        transition: "NONE",
        transitionMs: 0,
        hasAudio: probes[1].hasAudio,
      },
      {
        path: join(workDir, "c.mp4"),
        trimInMs: 0,
        trimOutMs: null,
        sourceDurationMs: probes[2].durationMs,
        speed: 1.25,
        transition: "CROSSFADE",
        transitionMs: 500,
        hasAudio: probes[2].hasAudio,
      },
    ]

    const masterPath = join(workDir, "master.mp4")
    const plan = buildCompositionGraph({
      clips,
      canvas,
      outputPath: masterPath,
      maxrateKbps: 6_000,
      threads: 2,
    })

    process.stdout.write(`\nfilter_complex:\n${plan.filterGraph}\n\n`)
    process.stdout.write("rendering master\n")

    let lastFraction = 0
    await runFfmpeg({
      args: plan.args,
      durationMs: plan.durationMs,
      onProgress: (progress) => {
        if (progress.fraction !== null) lastFraction = progress.fraction
      },
    })

    check("ffmpeg accepted the generated filter graph", true)
    check("progress reported a plausible fraction", lastFraction > 0 && lastFraction <= 1, lastFraction.toFixed(3))

    const master = await probeVideo(masterPath)
    check(
      "master duration matches the plan",
      Math.abs(master.durationMs - plan.durationMs) <= TOLERANCE_MS,
      `planned ${plan.durationMs}ms, got ${master.durationMs}ms`,
    )
    check(
      "master geometry matches the canvas",
      master.width === canvas.width && master.height === canvas.height,
      `${master.width}x${master.height}`,
    )
    check("master frame rate matches the canvas", Math.round(master.fps) === canvas.fps, String(master.fps))
    check(
      "master carries an audio track even though two clips are silent",
      master.hasAudio,
      master.hasAudio ? "present" : "missing",
    )
    check(
      "plannedDurationMs agrees with the graph it produced",
      plannedDurationMs(clips, canvas.fps) === plan.durationMs,
    )

    // -------------------------------------------------------------------- exports

    for (const target of [
      { key: "feed_square", width: 1080, height: 1080, fit: "cover" as const },
      { key: "youtube", width: 1920, height: 1080, fit: "contain" as const },
    ]) {
      const outputPath = join(workDir, `${target.key}.mp4`)
      const exportPlan = buildExportGraph({
        sourcePath: masterPath,
        outputPath,
        width: target.width,
        height: target.height,
        fps: canvas.fps,
        fit: target.fit,
        maxrateKbps: 5_000,
        threads: 2,
      })
      await runFfmpeg({ args: exportPlan.args, durationMs: master.durationMs })

      const rendered = await probeVideo(outputPath)
      check(
        `export ${target.key} has the target geometry`,
        rendered.width === target.width && rendered.height === target.height,
        `${rendered.width}x${rendered.height}`,
      )
      check(
        `export ${target.key} keeps the master's length`,
        Math.abs(rendered.durationMs - master.durationMs) <= TOLERANCE_MS,
        `${rendered.durationMs}ms vs ${master.durationMs}ms`,
      )
      check(`export ${target.key} keeps the audio track`, rendered.hasAudio)
    }

    check(
      "a vertical master pads rather than crops into landscape",
      chooseFit({ width: 1080, height: 1920 }, { width: 1920, height: 1080 }) === "contain",
    )

    // --------------------------------------------------------------------- poster

    const posterPath = join(workDir, "poster.jpg")
    await runFfmpeg({
      args: buildPosterArgs({
        sourcePath: masterPath,
        outputPath: posterPath,
        atMs: Math.floor(master.durationMs / 3),
        width: canvas.width,
        height: canvas.height,
      }),
    })
    const poster = await stat(posterPath)
    check("poster frame was written", poster.size > 2_000, `${poster.size} bytes`)

    // ------------------------------------------------------------- failure shapes

    const rejected = await runFfmpeg({
      args: ["-hide_banner", "-nostdin", "-y", "-i", join(workDir, "missing.mp4"), join(workDir, "nope.mp4")],
    })
      .then(() => null)
      .catch((error: unknown) => error)
    check(
      "a missing input fails as FFMPEG_FAILED rather than hanging",
      rejected !== null && (rejected as { safeErrorCode?: string }).safeErrorCode === "FFMPEG_FAILED",
      String((rejected as { safeErrorCode?: string })?.safeErrorCode),
    )
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }

  const failed = checks.filter((entry) => !entry.ok)
  process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`)
  if (failed.length > 0) process.exitCode = 1
}

main().catch((error: unknown) => {
  process.stderr.write(`\nverification aborted: ${error instanceof Error ? error.message : String(error)}\n`)
  if (error && typeof error === "object" && "detail" in error) {
    process.stderr.write(`${String((error as { detail: unknown }).detail)}\n`)
  }
  process.exitCode = 1
})
