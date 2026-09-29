import { describe, expect, it, vi } from "vitest"

import { R2StorageProvider } from "./r2"

function provider() {
  const r2 = new R2StorageProvider({
    endpoint: "https://acct.r2.cloudflarestorage.com",
    accessKeyId: "id",
    secretAccessKey: "secret",
    bucket: "adcrevia-bucket",
    publicBaseUrl: "https://pub-abc.r2.dev",
  })
  const send = vi.fn(async (command: { input: { Key: string } }) => ({
    Body: { transformToByteArray: async () => new Uint8Array([1]) },
    ContentType: "image/jpeg",
    key: command.input.Key,
  }))
  ;(r2 as unknown as { client: { send: typeof send } }).client = { send }
  return { r2, send }
}

describe("R2StorageProvider.readByUrl", () => {
  it("reads files by their public URL and by the bucket's own S3 address", async () => {
    const { r2, send } = provider()
    await r2.readByUrl("https://pub-abc.r2.dev/projects/p/images/01.jpg")
    await r2.readByUrl("https://acct.r2.cloudflarestorage.com/projects/p/images/02.jpg")
    await r2.readByUrl("https://acct.r2.cloudflarestorage.com/adcrevia-bucket/projects/p/images/03.jpg")
    expect(send.mock.calls.map(([command]) => command.input.Key)).toEqual([
      "projects/p/images/01.jpg",
      "projects/p/images/02.jpg",
      "projects/p/images/03.jpg",
    ])
  })

  it("ignores URLs that are not ours", async () => {
    const { r2, send } = provider()
    await expect(r2.readByUrl("https://cdn.shop.example/x.jpg")).resolves.toBeNull()
    expect(send).not.toHaveBeenCalled()
  })
})
