/**
 * Stored media links always point at the bucket's CURRENT public address.
 *
 * A media URL is recorded when the file is stored, under whatever public base URL was
 * configured then. Files stored before the public URL was set carry the bucket's
 * private S3 address (browsers get HTTP 400), and a later move — say from r2.dev to
 * media.adcrevia.com — would strand every earlier file the same way. Rewriting at read
 * time fixes both without touching stored data: any URL on an R2 host is re-pointed at
 * the current public base, keeping its object key.
 */

const R2_HOST = /(^|\.)r2\.(dev|cloudflarestorage\.com)$/i

export type MediaBase = { publicBaseUrl: string; bucket: string }

export function rewriteMediaUrl(value: string, base: MediaBase): string {
  if (!value.startsWith("https://")) return value
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  if (!R2_HOST.test(url.hostname)) return value
  const current = new URL(base.publicBaseUrl)
  if (url.host === current.host) return value
  let key = url.pathname.replace(/^\/+/, "")
  // Path-style S3 URLs carry the bucket first.
  if (key.startsWith(`${base.bucket}/`)) key = key.slice(base.bucket.length + 1)
  return key ? `${base.publicBaseUrl.replace(/\/$/, "")}/${key}` : value
}

/** Walk a query result and rewrite every stored R2 URL in it (including inside JSON columns). */
export function rewriteMediaUrls<T>(value: T, base: MediaBase, depth = 0): T {
  if (depth > 12 || value === null || value === undefined) return value
  if (typeof value === "string") return rewriteMediaUrl(value, base) as T
  if (Array.isArray(value)) return value.map((item) => rewriteMediaUrls(item, base, depth + 1)) as T
  if (typeof value === "object") {
    // Leave Dates, Decimals, Buffers and other class instances alone.
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = rewriteMediaUrls(item, base, depth + 1)
    return out as T
  }
  return value
}
