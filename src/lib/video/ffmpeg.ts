import { spawn } from "node:child_process"

/**
 * Running ffmpeg.
 *
 * `spawn` with an argv array, never a shell string. Filter graphs contain `;`, `[`,
 * `,` and quotes, and file paths come from storage keys — a shell in the middle of
 * that is both a quoting nightmare and a command injection waiting to happen.
 *
 * The CLI rather than a binding: the filter graph is the product here, and every
 * useful reference for `xfade`, `loudnorm` and `concat` is written as a command line.
 * A wrapper that reshapes that into method calls makes every future change a
 * translation exercise.
 *
 * Progress is parsed from `-progress pipe:1`, which emits real key/value lines. The
 * alternative is scraping the human-readable status line off stderr, which changes
 * between builds.
 */

/** Binary names, overridable for a host that puts them somewhere unusual. */
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg"
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe"

/** Ceiling on a single render. Beyond this something is wrong, not slow. */
const DEFAULT_TIMEOUT_MS = 20 * 60_000

/** How much stderr to keep for diagnosis. ffmpeg is verbose and most of it is noise. */
const STDERR_TAIL = 8_000

export class FfmpegError extends Error {
  constructor(
    readonly safeErrorCode: string,
    /** Tail of stderr. Operator-facing; never shown to a user. */
    readonly detail: string,
  ) {
    super(safeErrorCode)
    this.name = "FfmpegError"
  }
}

export type FfmpegProgress = {
  /** Output timestamp reached, milliseconds. */
  outTimeMs: number
  /** 0-1 against the expected duration, when one was supplied. */
  fraction: number | null
  /** Encoding rate relative to real time. Below 1 means slower than playback. */
  speed: number | null
}

export type RunFfmpegOptions = {
  args: string[]
  /** Expected output duration, so progress can be a fraction rather than a clock. */
  durationMs?: number
  onProgress?(progress: FfmpegProgress): void
  signal?: AbortSignal
  timeoutMs?: number
}

export async function runFfmpeg(options: RunFfmpegOptions): Promise<{ stderr: string }> {
  // `-progress pipe:1` writes machine-readable progress to stdout; `-nostats`
  // silences the duplicate human-readable version on stderr.
  const args = ["-progress", "pipe:1", "-nostats", ...options.args]

  return new Promise((resolve, reject) => {
    // The ignore hint stops Turbopack treating an env-derived binary path as file access and
    // tracing the whole project (public/, .env files) into the standalone server bundle.
    const child = spawn(/*turbopackIgnore: true*/ FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] })

    let stderr = ""
    let stdout = ""
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      reject(new FfmpegError("FFMPEG_TIMEOUT", stderr.slice(-STDERR_TAIL)))
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    const onAbort = () => {
      if (settled) return
      settled = true
      // SIGTERM lets ffmpeg finalise the container; a half-written MP4 with no
      // moov atom is unplayable and looks like a corrupt render rather than a
      // cancellation.
      child.kill("SIGTERM")
      reject(new FfmpegError("FFMPEG_ABORTED", ""))
    }
    options.signal?.addEventListener("abort", onAbort, { once: true })

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      if (error) reject(error)
      else resolve({ stderr: stderr.slice(-STDERR_TAIL) })
    }

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      // Progress arrives as blocks terminated by a `progress=` line.
      const blocks = stdout.split(/progress=\w+\s*/)
      stdout = blocks.pop() ?? ""
      for (const block of blocks) {
        const progress = parseProgress(block, options.durationMs)
        if (progress) options.onProgress?.(progress)
      }
    })

    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
      // Bounded, so a graph that errors on every frame cannot exhaust memory.
      if (stderr.length > STDERR_TAIL * 4) stderr = stderr.slice(-STDERR_TAIL * 2)
    })

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        new FfmpegError(
          error.code === "ENOENT" ? "FFMPEG_NOT_INSTALLED" : "FFMPEG_SPAWN_FAILED",
          error.message,
        ),
      )
    })

    child.on("close", (code) => {
      if (code === 0) return finish()
      finish(new FfmpegError("FFMPEG_FAILED", `exit ${code}\n${stderr.slice(-STDERR_TAIL)}`))
    })
  })
}

export type ProbeResult = {
  durationMs: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  bytes: number
}

/**
 * Read what a file actually is.
 *
 * Never trusted from the provider's metadata. A render that came back 4.8 seconds
 * when the request asked for 5 will silently shift every transition after it, and the
 * only way to know is to measure the file.
 */
export async function probeVideo(path: string, signal?: AbortSignal): Promise<ProbeResult> {
  const { stdout } = await runProbe(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ],
    signal,
  )

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new FfmpegError("FFPROBE_UNREADABLE", "ffprobe returned no JSON")
  }

  const payload = parsed as {
    format?: { duration?: string; size?: string }
    streams?: Array<{
      codec_type?: string
      width?: number
      height?: number
      duration?: string
      avg_frame_rate?: string
      r_frame_rate?: string
    }>
  }

  const streams = payload.streams ?? []
  const video = streams.find((stream) => stream.codec_type === "video")
  if (!video) throw new FfmpegError("FFPROBE_NO_VIDEO_STREAM", "no video stream")

  // Container duration first: a stream can report none, and the container's value is
  // what a player will use.
  const durationSeconds = Number(payload.format?.duration ?? video.duration ?? 0)

  return {
    durationMs: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : 0,
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate) || 30,
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
    bytes: Number(payload.format?.size ?? 0) || 0,
  }
}

/** Whether ffmpeg and ffprobe are actually present. Used by the health probe. */
export async function ffmpegAvailable(): Promise<{ ok: boolean; version: string | null }> {
  try {
    const { stderr } = await runFfmpeg({ args: ["-version"], timeoutMs: 10_000 })
    const line = stderr.split("\n").find((entry) => entry.startsWith("ffmpeg version"))
    return { ok: true, version: line?.trim() ?? null }
  } catch {
    // `-version` writes to stdout on most builds, so fall back to ffprobe, which
    // gives the same answer to the only question being asked.
    try {
      await runProbe(["-version"], undefined, 10_000)
      return { ok: true, version: null }
    } catch {
      return { ok: false, version: null }
    }
  }
}

function runProbe(
  args: string[],
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    // The ignore hint stops Turbopack treating an env-derived binary path as file access and
    // tracing the whole project (public/, .env files) into the standalone server bundle.
    const child = spawn(/*turbopackIgnore: true*/ FFPROBE, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      reject(new FfmpegError("FFPROBE_TIMEOUT", ""))
    }, timeoutMs)

    const onAbort = () => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      reject(new FfmpegError("FFPROBE_ABORTED", ""))
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(
        new FfmpegError(
          error.code === "ENOENT" ? "FFPROBE_NOT_INSTALLED" : "FFPROBE_SPAWN_FAILED",
          error.message,
        ),
      )
    })

    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      if (code === 0) resolve({ stdout })
      else reject(new FfmpegError("FFPROBE_FAILED", `exit ${code}\n${stderr.slice(-1_000)}`))
    })
  })
}

/**
 * Parse one `-progress` block.
 *
 * Exported for tests: the format is stable but undocumented, and the units are a trap
 * — `out_time_ms` is microseconds despite the name, which is worth pinning rather
 * than rediscovering from a progress bar that runs to 100,000%.
 */
export function parseProgress(block: string, durationMs?: number): FfmpegProgress | null {
  const values = new Map<string, string>()
  for (const line of block.split("\n")) {
    const separator = line.indexOf("=")
    if (separator <= 0) continue
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }

  const raw = values.get("out_time_ms") ?? values.get("out_time_us")
  if (!raw) return null
  const microseconds = Number(raw)
  if (!Number.isFinite(microseconds)) return null

  const outTimeMs = Math.max(0, Math.round(microseconds / 1000))
  const speed = Number.parseFloat(values.get("speed") ?? "")

  return {
    outTimeMs,
    fraction: durationMs && durationMs > 0 ? Math.min(1, outTimeMs / durationMs) : null,
    speed: Number.isFinite(speed) ? speed : null,
  }
}

/** ffprobe reports frame rates as a rational, e.g. `30000/1001`. */
export function parseFrameRate(value: string | undefined): number {
  if (!value) return 0
  const [numerator, denominator] = value.split("/")
  const top = Number(numerator)
  const bottom = denominator === undefined ? 1 : Number(denominator)
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return 0
  return Math.round((top / bottom) * 1000) / 1000
}
