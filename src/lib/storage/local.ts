import { mkdir, unlink, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"

import type { StorageProvider } from "./types"

export class LocalStorageProvider implements StorageProvider {
  private readonly root: string
  private readonly publicBaseUrl: string

  constructor(config: { root: string; publicBaseUrl: string }) {
    this.root = resolve(config.root)
    this.publicBaseUrl = config.publicBaseUrl.replace(/\/$/, "")
  }

  async put({ key, bytes }: { key: string; bytes: Uint8Array; contentType: string }) {
    const target = this.targetFor(key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    return { url: `${this.publicBaseUrl}/${key.replaceAll("\\", "/")}` }
  }

  async copyRemote({ key, sourceUrl }: { key: string; sourceUrl: string; contentType?: string }) {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error("REMOTE_ASSET_UNAVAILABLE")
    return this.put({
      key,
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    })
  }

  async delete(key: string) {
    await unlink(this.targetFor(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
  }

  private targetFor(key: string) {
    const target = resolve(this.root, key)
    if (!target.startsWith(`${this.root}${sep}`)) throw new Error("INVALID_STORAGE_KEY")
    return target
  }
}
