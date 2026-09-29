import { readFile, stat } from "node:fs/promises"
import { extname, join, resolve, sep } from "node:path"

import { createStorageProvider } from "./runtime"
import type { StorageProvider } from "./types"

/** R2 objects we inline: generated frames and product photos are a few MB at most. */
const MAX_INLINE_BYTES = 12 * 1024 * 1024

export async function prepareImageForProvider(
  source: string,
  options: { appUrl?: string; maxBytes?: number; storage?: StorageProvider | null } = {},
) {
  const appUrl = new URL(options.appUrl ?? process.env.APP_URL ?? "http://localhost:3000")
  const url = new URL(source, appUrl)
  if (url.origin !== appUrl.origin || !url.pathname.startsWith("/generated/")) {
    // One of our R2 objects: read it with the bucket credentials and send it inline.
    // Providers then never fetch our bucket by URL, so a bucket that is not public,
    // or a slow CDN, cannot fail a paid generation. Anything else passes through.
    const storage = options.storage === undefined ? await createStorageProvider().catch(() => null) : options.storage
    const stored = await storage?.readByUrl?.(source).catch(() => null)
    if (!stored) return source
    if (stored.bytes.byteLength > MAX_INLINE_BYTES) throw new Error("STORED_ASSET_TOO_LARGE")
    return `data:${stored.contentType};base64,${Buffer.from(stored.bytes).toString("base64")}`
  }

  const root = resolve(join(process.cwd(), "public", "generated"))
  const relative = decodeURIComponent(url.pathname.slice("/generated/".length))
  const target = resolve(root, relative)
  if (!target.startsWith(`${root}${sep}`)) throw new Error("INVALID_STORAGE_KEY")

  const metadata = await stat(target)
  if (metadata.size > (options.maxBytes ?? 5 * 1024 * 1024)) throw new Error("LOCAL_ASSET_TOO_LARGE")
  const bytes = await readFile(target)
  return `data:${contentType(target)};base64,${bytes.toString("base64")}`
}

function contentType(path: string) {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" })[extname(path).toLowerCase()] ?? "application/octet-stream"
}
