import { describe, expect, it } from "vitest"

import { rewriteMediaUrl, rewriteMediaUrls } from "./media-urls"

const base = { publicBaseUrl: "https://pub-new.r2.dev", bucket: "adcrevia-bucket" }

describe("media URL rewriting", () => {
  it("re-points private S3 addresses and old public URLs at the current public base", () => {
    expect(rewriteMediaUrl("https://acct.r2.cloudflarestorage.com/projects/p/images/1.jpg", base)).toBe("https://pub-new.r2.dev/projects/p/images/1.jpg")
    expect(rewriteMediaUrl("https://acct.r2.cloudflarestorage.com/adcrevia-bucket/projects/p/a.jpg", base)).toBe("https://pub-new.r2.dev/projects/p/a.jpg")
    expect(rewriteMediaUrl("https://pub-old.r2.dev/projects/p/v.mp4", base)).toBe("https://pub-new.r2.dev/projects/p/v.mp4")
  })

  it("leaves current, foreign and non-URL values untouched", () => {
    expect(rewriteMediaUrl("https://pub-new.r2.dev/x.jpg", base)).toBe("https://pub-new.r2.dev/x.jpg")
    expect(rewriteMediaUrl("https://cdn.factori.com/shirt.webp", base)).toBe("https://cdn.factori.com/shirt.webp")
    expect(rewriteMediaUrl("hello", base)).toBe("hello")
  })

  it("walks rows, nested relations and JSON columns, and keeps Dates intact", () => {
    const when = new Date("2026-09-25T00:00:00Z")
    const rows = [{ url: "https://acct.r2.cloudflarestorage.com/a.jpg", createdAt: when, prompt: { productJson: { referenceImages: ["https://acct.r2.cloudflarestorage.com/r.jpg"] } } }]
    const out = rewriteMediaUrls(rows, base)
    expect(out[0].url).toBe("https://pub-new.r2.dev/a.jpg")
    expect(out[0].prompt.productJson.referenceImages[0]).toBe("https://pub-new.r2.dev/r.jpg")
    expect(out[0].createdAt).toBe(when)
  })
})
