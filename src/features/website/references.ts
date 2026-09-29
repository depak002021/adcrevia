import { createHash } from "node:crypto"

import type { StorageProvider } from "@/lib/storage/types"
import { ensureUniversalImage } from "@/lib/video/image-format"

import { readCappedBytes, safeFetch } from "./safe-fetch"

/**
 * Copy the product's own photos into our storage, once, when the page is analysed.
 *
 * Every generator that is handed "the product" afterwards (FLUX.2 and OpenAI image
 * references, Seedance video references) then reads a stable URL on our bucket rather
 * than hot-linking the shop's CDN, which may rotate URLs, rate-limit, or block
 * non-browser clients mid-generation — a failure that would cost a paid call.
 *
 * Best-effort per image: one unreachable photo drops that photo, not the analysis.
 */

/** Formats every reference-capable provider accepts (FLUX.2, OpenAI, Seedance). */
const ACCEPTED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}
const MAX_BYTES = 12 * 1024 * 1024
/** Below this a "photo" is an icon or a placeholder; Seedance also rejects < 300px. */
const MIN_BYTES = 8 * 1024
const MAX_REDIRECTS = 3

export type StoredReference = { url: string; sourceUrl: string; contentType: string }

/** undici's Response (what `safeFetch` returns), not the DOM global. */
type FetchedResponse = Awaited<ReturnType<typeof safeFetch>>
type Fetcher = (url: string) => Promise<FetchedResponse>
type Converter = (bytes: Uint8Array, contentType: string) => Promise<{ bytes: Uint8Array; contentType: string }>

export async function storeReferenceImages(
  projectId: string,
  sourceUrls: string[],
  storage: StorageProvider,
  fetcher: Fetcher = followSafely,
  convert: Converter = ensureUniversalImage,
): Promise<StoredReference[]> {
  const stored: StoredReference[] = []
  for (const [index, sourceUrl] of sourceUrls.entries()) {
    try {
      const response = await fetcher(sourceUrl)
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        continue
      }
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
      const extension = ACCEPTED_TYPES[contentType]
      if (!extension) {
        await response.body?.cancel().catch(() => {})
        continue
      }
      const downloaded = await readCappedBytes(response, MAX_BYTES)
      if (downloaded.byteLength < MIN_BYTES) continue

      // Stored as JPEG/PNG so every video provider (Kling accepts nothing else) can
      // read the same copy.
      const { bytes, contentType: storedType } = await convert(downloaded, contentType)
      const storedExtension = storedType === "image/png" ? "png" : storedType === "image/jpeg" ? "jpg" : extension
      const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16)
      const key = `projects/${projectId}/references/${String(index + 1).padStart(2, "0")}-${digest}.${storedExtension}`
      const asset = await storage.put({ key, bytes, contentType: storedType })
      stored.push({ url: asset.url, sourceUrl, contentType: storedType })
    } catch (error) {
      console.warn("[website] reference image skipped", {
        projectId,
        reason: error instanceof Error ? error.message : "unknown",
      })
    }
  }
  return stored
}

/** `safeFetch` refuses to follow redirects itself; each hop is re-checked here. */
async function followSafely(url: string): Promise<FetchedResponse> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await safeFetch(current, { headers: { accept: "image/webp,image/jpeg,image/png;q=0.9,*/*;q=0.1" } })
    const location = response.headers.get("location")
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {})
      current = new URL(location, current).toString()
      continue
    }
    return response
  }
  throw new Error("WEBSITE_REDIRECT_LIMIT")
}
