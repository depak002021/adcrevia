import { LocalStorageProvider } from "./local"
import { R2StorageProvider } from "./r2"
import { resolveStorageSettings, type StorageSettings } from "./configuration"
import type { StorageProvider } from "./types"

/**
 * Build the storage provider.
 *
 * Asynchronous because the configuration can live in the database now: an administrator
 * connecting a bucket from the console must take effect without a deploy. Every caller
 * was already inside an `async` function, so this costs nothing at the call sites.
 *
 * Deliberately not cached. Resolution is one indexed read, the same cost the image and
 * video providers already pay per call, and caching it would mean an administrator
 * rotating a leaked key does not take effect until a restart — which is exactly the
 * moment it needs to.
 */
export async function createStorageProvider(settings?: StorageSettings): Promise<StorageProvider> {
  const resolved = settings ?? (await resolveStorageSettings())

  if (resolved.kind === "r2") {
    return new R2StorageProvider({
      endpoint: resolved.endpoint,
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
      bucket: resolved.bucket,
      publicBaseUrl: resolved.publicBaseUrl,
    })
  }

  return new LocalStorageProvider({ root: resolved.root, publicBaseUrl: resolved.publicBaseUrl })
}
