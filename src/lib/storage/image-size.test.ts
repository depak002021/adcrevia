import { describe, expect, it } from "vitest"

import { imageDimensions } from "./image-size"

describe("imageDimensions", () => {
  it("reads PNG and JPEG headers", () => {
    const png = new Uint8Array(32)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    new DataView(png.buffer).setUint32(16, 1536)
    new DataView(png.buffer).setUint32(20, 2752)
    expect(imageDimensions(png)).toEqual({ width: 1536, height: 2752 })

    // SOI, APP0 (length 16), SOF0 with height 2048 and width 1152.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x08, 0x00, 0x04, 0x80, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(imageDimensions(jpeg)).toEqual({ width: 1152, height: 2048 })
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})
