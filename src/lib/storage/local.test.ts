import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { LocalStorageProvider } from "./local"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

describe("LocalStorageProvider", () => {
  it("stores generated media under an isolated public directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "adcrevia-storage-"))
    directories.push(root)
    const provider = new LocalStorageProvider({ root, publicBaseUrl: "http://localhost:3000/generated" })

    const result = await provider.put({
      key: "projects/project_1/images/image_1.webp",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/webp",
    })

    await expect(readFile(join(root, "projects/project_1/images/image_1.webp"))).resolves.toEqual(Buffer.from([1, 2, 3]))
    expect(result.url).toBe("http://localhost:3000/generated/projects/project_1/images/image_1.webp")
  })

  it("rejects keys that escape the storage root", async () => {
    const root = await mkdtemp(join(tmpdir(), "adcrevia-storage-"))
    directories.push(root)
    const provider = new LocalStorageProvider({ root, publicBaseUrl: "http://localhost:3000/generated" })

    await expect(provider.put({ key: "../secret", bytes: new Uint8Array([1]), contentType: "text/plain" })).rejects.toThrow("INVALID_STORAGE_KEY")
  })
})
