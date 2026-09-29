export type StoredAsset = { url: string; etag?: string }

export interface StorageProvider {
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<StoredAsset>
  copyRemote?(input: { key: string; sourceUrl: string; contentType?: string }): Promise<StoredAsset>
  delete?(key: string): Promise<void>
  /**
   * Read back a file this storage holds, given its public URL; null when the URL is
   * not ours. Lets provider inputs be sent inline instead of fetched by URL, so
   * generation never depends on the bucket being publicly readable.
   */
  readByUrl?(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null>
}
