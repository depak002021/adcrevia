import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

import type { StorageProvider } from "./types"

export class R2StorageProvider implements StorageProvider {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly publicBaseUrl: string
  private readonly endpointHost: string | null

  constructor(config: ReturnType<typeof readR2Config> = readR2Config()) {
    this.bucket = config.bucket
    this.publicBaseUrl = config.publicBaseUrl.replace(/\/$/, "")
    this.endpointHost = hostOf(config.endpoint)
    this.client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    })
  }

  async put({ key, bytes, contentType }: { key: string; bytes: Uint8Array; contentType: string }) {
    const result = await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }))
    return { url: `${this.publicBaseUrl}/${key}`, etag: result.ETag }
  }

  async copyRemote({ key, sourceUrl, contentType }: { key: string; sourceUrl: string; contentType?: string }) {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error("REMOTE_ASSET_UNAVAILABLE")
    const bytes = new Uint8Array(await response.arrayBuffer())
    return this.put({ key, bytes, contentType: contentType ?? response.headers.get("content-type") ?? "application/octet-stream" })
  }

  /**
   * The object key behind one of our URLs. Recognises the current public base URL and
   * also the bucket's own S3 endpoint host: files recorded before the public URL was
   * set (or changed) keep that address, and must stay readable for generation.
   */
  private keyFor(url: string): string | null {
    const prefix = `${this.publicBaseUrl}/`
    if (url.startsWith(prefix)) return decodeURIComponent(url.slice(prefix.length).split("?")[0])
    try {
      const parsed = new URL(url)
      if (!this.endpointHost || parsed.host !== this.endpointHost) return null
      const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""))
      // Path-style URLs carry the bucket first.
      return path.startsWith(`${this.bucket}/`) ? path.slice(this.bucket.length + 1) : path || null
    } catch {
      return null
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async readByUrl(url: string) {
    const key = this.keyFor(url)
    if (!key) return null
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!result.Body) return null
    return {
      bytes: await result.Body.transformToByteArray(),
      contentType: result.ContentType ?? "application/octet-stream",
    }
  }
}

function readR2Config() {
  const endpoint = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    throw new Error("R2_STORAGE_CONFIG_REQUIRED")
  }
  return { endpoint, accessKeyId, secretAccessKey, bucket, publicBaseUrl }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
