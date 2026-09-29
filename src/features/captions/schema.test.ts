import { describe, expect, it } from "vitest"

import { captionFor, tidySocialCopy } from "./schema"

const body = {
  hooks: ["One", "Two", "Three"],
  instagram: { caption: "Colour that lasts all Holi.", hashtags: ["holi", "#Holi", "#holi tshirt", "  "] },
  tiktok: { caption: "POV: your tee survives the colour fight", hashtags: ["#fyp", "holi"] },
  youtube: { title: "x".repeat(140), description: "Desc", hashtags: ["#shorts"] },
  meta: { primaryText: "Primary", headline: "A headline that is far too long for the Meta ad slot", linkDescription: "Short" },
}

describe("social copy", () => {
  it("cleans and de-duplicates hashtags and applies platform limits", () => {
    const tidy = tidySocialCopy(body)
    expect(tidy.instagram.hashtags).toEqual(["#holi", "#holitshirt"])
    expect(tidy.youtube.title.length).toBeLessThanOrEqual(100)
    expect(tidy.meta.headline.length).toBeLessThanOrEqual(40)
  })

  it("assembles the text to paste per platform", () => {
    const tidy = tidySocialCopy(body)
    expect(captionFor(tidy, "instagram")).toBe("Colour that lasts all Holi.\n\n#holi #holitshirt")
    expect(captionFor(tidy, "tiktok")).toBe("POV: your tee survives the colour fight #fyp #holi")
  })
})
