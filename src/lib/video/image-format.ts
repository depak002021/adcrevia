import { writeFile } from "node:fs/promises"

import { runFfmpeg } from "./ffmpeg"
import { createRenderWorkspace } from "./workspace"

/** Every provider we call accepts these (Kling accepts only JPEG and PNG). */
const UNIVERSAL = new Set(["image/jpeg", "image/png"])

/**
 * Re-encode an image as JPEG when a provider might not read its format.
 *
 * Shops increasingly serve WebP or AVIF product photos; Kling image-to-video rejects
 * anything but JPEG/PNG, and a rejected paid request is a wasted one. ffmpeg is in
 * the runtime image already (it is the video engine), so no extra dependency.
 */
export async function ensureUniversalImage(bytes: Uint8Array, contentType: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (UNIVERSAL.has(contentType)) return { bytes, contentType }
  const workspace = await createRenderWorkspace("adcrevia-image-")
  try {
    const input = workspace.path("source.img")
    await writeFile(input, bytes)
    await runFfmpeg({ args: ["-y", "-i", input, "-frames:v", "1", "-q:v", "2", workspace.path("out.jpg")], timeoutMs: 60_000 })
    const converted = await workspace.read("out.jpg")
    return { bytes: converted.bytes, contentType: "image/jpeg" }
  } finally {
    await workspace.dispose()
  }
}
