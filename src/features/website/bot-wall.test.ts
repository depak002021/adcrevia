import { describe, expect, it } from "vitest"

import { looksLikeBotWall } from "./bot-wall"

describe("looksLikeBotWall", () => {
  it("recognises Amazon's interstitial and challenge pages", () => {
    expect(looksLikeBotWall({ html: "<!-- To discuss automated access to Amazon data please contact api-services-support@amazon.com -->", text: "Click the button below to continue shopping", productCount: 0 })).toBe(true)
    expect(looksLikeBotWall({ html: "<title>Just a moment...</title>", text: "Checking your browser", productCount: 0 })).toBe(true)
  })

  it("never flags a real product page, even one that mentions captcha", () => {
    expect(looksLikeBotWall({ html: "<form>captcha</form>", text: "x".repeat(4000), productCount: 0 })).toBe(false)
    expect(looksLikeBotWall({ html: "captcha", text: "short", productCount: 1 })).toBe(false)
    expect(looksLikeBotWall({ html: "<h1>Linen shirt</h1>", text: "A linen shirt", productCount: 0 })).toBe(false)
  })
})
