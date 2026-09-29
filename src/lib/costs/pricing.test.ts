import { describe, expect, it } from "vitest"

import { bflCost, estimateImageUsd, geminiImageCost, openAiImageCost } from "./pricing"

describe("costs from provider figures", () => {
  it("converts BFL credits at $0.01 each", () => {
    expect(bflCost(7.5)).toEqual({ usd: 0.075, source: "provider" })
    expect(bflCost(undefined)).toBeNull()
  })

  it("prices OpenAI image usage per token type", () => {
    // gpt-image-2: 1,000 text in at $5/M, 2,000 image in at $8/M, 6,240 image out at $30/M.
    const cost = openAiImageCost("gpt-image-2", { input_tokens: 3000, output_tokens: 6240, input_tokens_details: { text_tokens: 1000, image_tokens: 2000 } })
    expect(cost?.usd).toBeCloseTo(0.005 + 0.016 + 0.1872, 4)
  })

  it("prices Gemini image tokens at the image rate and the rest at the text rate", () => {
    const cost = geminiImageCost("gemini-3.1-flash-image", {
      promptTokenCount: 1000,
      candidatesTokenCount: 1780,
      candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1680 }],
    })
    expect(cost?.usd).toBeCloseTo(0.0005 + 0.1008 + 0.0003, 4)
  })

  it("estimates before a run from list prices", () => {
    expect(estimateImageUsd("google", "gemini-3.1-flash-image", "9:16")).toBe(0.101)
    expect(estimateImageUsd("bfl", "flux-2-flex", "9:16")).toBeCloseTo(2.359 * 0.05, 3)
    expect(estimateImageUsd("openai", "gpt-image-2", "9:16")).toBeCloseTo(0.1872, 4)
    expect(estimateImageUsd("runway", "x", "1:1")).toBeNull()
  })
})
