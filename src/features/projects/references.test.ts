import { describe, expect, it } from "vitest"

import { productPhotosFrom, referenceUrlsFrom } from "./references"

describe("product photo references", () => {
  it("puts the user's uploads first, then the page's photos, without duplicates, capped at six", () => {
    const json = {
      uploadedReferences: ["u1", "u2"],
      referenceImages: ["w1", "u1", "w2", "w3", "w4", "w5"],
    }
    expect(referenceUrlsFrom(json)).toEqual(["u1", "u2", "w1", "w2", "w3", "w4"])
  })

  it("tolerates missing or malformed data", () => {
    expect(referenceUrlsFrom(null)).toEqual([])
    expect(productPhotosFrom({ uploadedReferences: "nope", referenceImages: [1, "w"] })).toEqual({ uploaded: [], fromWebsite: ["w"] })
  })
})
