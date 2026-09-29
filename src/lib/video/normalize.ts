import { runFfmpeg } from "./ffmpeg"
import { createRenderWorkspace } from "./workspace"

/**
 * Re-encode a provider's output as H.264/AAC MP4 with the index up front.
 *
 * Seedance 2.5 renders 1080p as 10-bit H.265, which Firefox and many Chrome/Android
 * setups cannot play; a video the client cannot open in the browser is a broken demo.
 * H.264 yuv420p plays everywhere and is what social platforms ingest anyway.
 *
 * Runs in the worker (see features/videos/service.ts): a 30-second 1080p encode is
 * too heavy for a request handler.
 */
export async function downloadAsWebMp4(sourceUrl: string): Promise<{ bytes: Uint8Array; checksum: string }> {
  const workspace = await createRenderWorkspace("adcrevia-normalize-")
  try {
    const input = await workspace.fetch({ url: sourceUrl, name: "source.mp4" })
    const threads = process.env.FFMPEG_THREADS?.trim()
    await runFfmpeg({
      args: [
        "-y",
        "-i",
        input,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        ...(threads ? ["-threads", threads] : []),
        workspace.path("web.mp4"),
      ],
      timeoutMs: 15 * 60_000,
    })
    const { bytes, checksum } = await workspace.read("web.mp4")
    return { bytes, checksum }
  } finally {
    await workspace.dispose()
  }
}
