import { describe, expect, it, vi } from "vitest"

import { planReferences, safeHttpError, SeedanceVideoProvider, seedancePrompt } from "./seedance"
import { estimateSeedanceCostUsd, estimateSeedanceTokens, seedanceCostFromTokens } from "./seedance-models"

const V25 = "dreamina-seedance-2-5-260628"
const V20 = "dreamina-seedance-2-0-260128"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const scenes = [
  { id: "a", url: "https://m/a.webp", position: 1 },
  { id: "b", url: "https://m/b.webp", position: 2 },
  { id: "c", url: "https://m/c.webp", position: 3 },
]

describe("Seedance pricing", () => {
  it("reproduces BytePlus's published 5-second prices", () => {
    expect(estimateSeedanceCostUsd(V25, 5, "480p")).toBeCloseTo(0.514, 2)
    expect(estimateSeedanceCostUsd(V25, 5, "720p")).toBeCloseTo(1.156, 2)
    expect(estimateSeedanceCostUsd(V25, 5, "1080p")).toBeCloseTo(2.843, 2)
  })

  it("prices actual usage from reported tokens", () => {
    expect(seedanceCostFromTokens(V25, 108_000, "720p")).toBeCloseTo(1.156, 3)
    expect(estimateSeedanceTokens(5, "720p")).toBe(108_000)
    expect(seedanceCostFromTokens("unknown", 1000, "720p")).toBeNull()
  })
})

describe("seedancePrompt", () => {
  it("labels storyboard frames and product photos and plans shots across the duration", () => {
    const prompt = seedancePrompt({ prompt: "A creator shows the shirt.", duration: 24 }, { sceneCount: 3, productCount: 2 })
    expect(prompt).toContain("@Image1 to @Image3 are the storyboard frames")
    expect(prompt).toContain("@Image4 to @Image5 are photos of the exact product")
    expect(prompt).toContain("Shot 1 (0-8s): based on @Image1.")
    expect(prompt).toContain("Shot 3 (16-24s): based on @Image3.")
  })

  it("keeps a single-frame prompt free of a shot plan", () => {
    const prompt = seedancePrompt({ prompt: "Hero spin.", duration: 10 }, { sceneCount: 1, productCount: 1 })
    expect(prompt).toContain("@Image1 is the key frame")
    expect(prompt).toContain("@Image2 is a photo of the exact product")
    expect(prompt).not.toContain("Shot plan")
  })
})

describe("planReferences", () => {
  it("puts scenes first, then product photos, within the model's limit and without duplicates", () => {
    const plan = planReferences({ sourceImages: scenes, referenceImages: ["https://m/p1.jpg", "https://m/a.webp", "https://m/p2.jpg"] }, 4)
    expect(plan).toEqual({ urls: ["https://m/a.webp", "https://m/b.webp", "https://m/c.webp", "https://m/p1.jpg"], sceneCount: 3, productCount: 1 })
  })
})

describe("SeedanceVideoProvider", () => {
  it("creates a reference-mode task with the chosen ratio, duration, resolution and sound", async () => {
    const fetch = vi.fn(async () => json({ id: "cgt-1" }))
    const provider = new SeedanceVideoProvider({ apiKey: "k", model: V25, fetch: fetch as never })
    const result = await provider.create({ sourceImages: scenes, referenceImages: ["https://m/p.jpg"], prompt: "Reel", duration: 24, aspectRatio: "9:16", resolution: "720p" })
    expect(result).toEqual({ taskId: "cgt-1", taskMetadata: { resolution: "720p", draft: false, duration: 24 } })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks")
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k")
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ model: V25, ratio: "9:16", duration: 24, resolution: "720p", generate_audio: true, watermark: false })
    expect(body.draft).toBeUndefined()
    expect(body.content.filter((item: { role?: string }) => item.role === "reference_image")).toHaveLength(4)
  })

  it("renders drafts at 480p and finals from a draft at 1080p", async () => {
    const fetch = vi.fn(async () => json({ id: "cgt-2" }))
    const provider = new SeedanceVideoProvider({ apiKey: "k", model: V25, fetch: fetch as never })
    await provider.create({ sourceImages: scenes.slice(0, 1), prompt: "Reel", duration: 10, aspectRatio: "9:16", draft: true, resolution: "1080p" })
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ draft: true, resolution: "480p" })

    await provider.createFromDraft("cgt-2")
    const final = JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(final).toEqual({ model: V25, content: [{ type: "draft_task", draft_task: { id: "cgt-2" } }], resolution: "1080p", watermark: false })
  })

  it("refuses, before any call, what the model cannot do", async () => {
    const fetch = vi.fn()
    const v20 = new SeedanceVideoProvider({ apiKey: "k", model: V20, fetch: fetch as never })
    await expect(v20.create({ sourceImages: scenes, prompt: "x", duration: 20, aspectRatio: "9:16" })).rejects.toThrow("DURATION_UNSUPPORTED")
    await expect(v20.create({ sourceImages: scenes, prompt: "x", duration: 10, aspectRatio: "9:16", draft: true })).rejects.toThrow("DRAFT_UNSUPPORTED")
    await expect(v20.create({ sourceImages: scenes, prompt: "x", duration: 10, aspectRatio: "4:5" })).rejects.toThrow("ASPECT_RATIO_UNSUPPORTED")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("maps task states and reports token usage", async () => {
    const responses = [
      json({ status: "running" }),
      json({ status: "succeeded", content: { video_url: "https://out/v.mp4" }, usage: { completion_tokens: 108000 } }),
      json({ status: "failed", error: { code: "OutputVideoSensitiveContentDetected" } }),
      json({ status: "expired" }),
    ]
    const provider = new SeedanceVideoProvider({ apiKey: "k", fetch: (async () => responses.shift()!) as never })
    await expect(provider.getStatus("t")).resolves.toEqual({ state: "RUNNING" })
    await expect(provider.getStatus("t")).resolves.toEqual({ state: "SUCCEEDED", outputUrl: "https://out/v.mp4", usage: { tokens: 108000 } })
    await expect(provider.getStatus("t")).resolves.toMatchObject({ state: "FAILED", errorCode: "PROVIDER_MODERATED" })
    await expect(provider.getStatus("t")).resolves.toEqual({ state: "FAILED", errorCode: "PROVIDER_TIMEOUT" })
  })

  it("turns HTTP failures into safe, actionable codes", async () => {
    expect(safeHttpError(401, undefined)).toBe("PROVIDER_AUTHENTICATION_FAILED")
    expect(safeHttpError(403, "ModelNotOpen")).toBe("PROVIDER_MODEL_NOT_ACTIVATED")
    expect(safeHttpError(403, "AccountOverdueError")).toBe("PROVIDER_BILLING")
    expect(safeHttpError(429, undefined)).toBe("PROVIDER_RATE_LIMIT")
    expect(safeHttpError(400, "InvalidParameter")).toBe("PROVIDER_REJECTED")
    const provider = new SeedanceVideoProvider({ apiKey: "k", fetch: (async () => json({ error: { code: "ModelNotOpen" } }, 404)) as never })
    await expect(provider.create({ sourceImages: scenes, prompt: "x", duration: 10, aspectRatio: "9:16" })).rejects.toThrow("PROVIDER_MODEL_NOT_ACTIVATED")
  })
})
