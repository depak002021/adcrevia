import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { prepareImageForProvider } from "./provider-assets"

const root = join(process.cwd(), "public", "generated", "provider-assets-test")
afterEach(() => rm(root, { recursive: true, force: true }))

describe("prepareImageForProvider", () => {
  it("converts a local generated image to a provider-safe data URI", async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, "sample.webp"), Buffer.from([1, 2, 3]))

    await expect(prepareImageForProvider("http://localhost:3000/generated/provider-assets-test/sample.webp", {
      appUrl: "http://localhost:3000",
    })).resolves.toBe("data:image/webp;base64,AQID")
  })

  it("leaves public provider-accessible URLs unchanged", async () => {
    await expect(prepareImageForProvider("https://media.example/image.webp", { appUrl: "http://localhost:3000" }))
      .resolves.toBe("https://media.example/image.webp")
  })
})
