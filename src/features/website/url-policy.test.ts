import { describe, expect, it } from "vitest"

import { assertPublicHttpUrl } from "./url-policy"

describe("assertPublicHttpUrl", () => {
  it.each([
    "http://127.0.0.1",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.8",
    "http://172.16.0.1",
    "http://192.168.1.20",
    "http://[::1]",
    "file:///etc/passwd",
  ])("rejects non-public target %s", async (url) => {
    await expect(assertPublicHttpUrl(url)).rejects.toThrow("PUBLIC_HTTP_URL_REQUIRED")
  })

  it("rejects a hostname when DNS resolves to a private address", async () => {
    await expect(
      assertPublicHttpUrl("https://example.test", async () => [{ address: "10.0.0.2", family: 4 }] as const),
    ).rejects.toThrow("PUBLIC_HTTP_URL_REQUIRED")
  })

  it("accepts an http URL when every resolved address is public", async () => {
    await expect(
      assertPublicHttpUrl("https://adcrevia.example/brand", async () => [{ address: "93.184.216.34", family: 4 }] as const),
    ).resolves.toMatchObject({ protocol: "https:", hostname: "adcrevia.example" })
  })
})
