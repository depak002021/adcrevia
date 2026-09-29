import { describe, expect, it } from "vitest"

import { videoFileName } from "./download-name"

describe("videoFileName", () => {
  it("makes a safe, descriptive file name", () => {
    expect(videoFileName("POC test — UGC-style Instagram ad for this Holi t-shirt!", 15, "9:16")).toBe("poc-test-ugc-style-instagram-ad-for-this-holi-t-15s-9x16.mp4")
    expect(videoFileName("ऑफर", 8, "16:9")).toBe("adcrevia-video-8s-16x9.mp4")
  })
})
