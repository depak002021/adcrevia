import { describe, expect, it, vi } from "vitest"

import type { StorageProvider } from "@/lib/storage/types"

import { storeReferenceImages } from "./references"

function imageResponse(contentType: string, size: number, status = 200) {
  return new Response(new Uint8Array(size), { status, headers: { "content-type": contentType } }) as never
}

function memoryStorage() {
  const put = vi.fn(async ({ key }: { key: string }) => ({ url: `https://media.example/${key}` }))
  return { storage: { put } satisfies StorageProvider, put }
}

describe("storeReferenceImages", () => {
  it("copies accepted product photos into project storage", async () => {
    const { storage, put } = memoryStorage()
    const toJpeg = vi.fn(async (bytes: Uint8Array) => ({ bytes, contentType: "image/jpeg" }))
    const stored = await storeReferenceImages("proj1", ["https://cdn.shop/a.webp"], storage, async () => imageResponse("image/webp", 20_000), toJpeg)
    expect(stored).toHaveLength(1)
    // WebP is converted so providers that only read JPEG/PNG (Kling) get the same copy.
    expect(toJpeg).toHaveBeenCalledWith(expect.any(Uint8Array), "image/webp")
    expect(stored[0]).toMatchObject({ sourceUrl: "https://cdn.shop/a.webp", contentType: "image/jpeg" })
    expect(put.mock.calls[0][0].key).toMatch(/^projects\/proj1\/references\/01-[0-9a-f]{16}\.jpg$/)
  })

  it("skips formats providers cannot read, tiny placeholders and failed downloads, keeping the rest", async () => {
    const { storage } = memoryStorage()
    const responses: Record<string, () => unknown> = {
      "https://cdn/avif": () => imageResponse("image/avif", 20_000),
      "https://cdn/tiny": () => imageResponse("image/png", 500),
      "https://cdn/404": () => imageResponse("image/png", 20_000, 404),
      "https://cdn/throws": () => {
        throw new Error("BLOCKED_PRIVATE_ADDRESS")
      },
      "https://cdn/good": () => imageResponse("image/jpeg; charset=binary", 30_000),
    }
    const stored = await storeReferenceImages("p", Object.keys(responses), storage, async (url) => responses[url]() as never, async (bytes, contentType) => ({ bytes, contentType }))
    expect(stored.map((item) => item.sourceUrl)).toEqual(["https://cdn/good"])
  })
})
