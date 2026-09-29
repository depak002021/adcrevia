import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FluxVideoProvider, keyframesFor, minimumDurationForSources } from "./flux"

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const IMAGE_ONE = { id: "img_1", url: "data:image/webp;base64,one", position: 1 }
const IMAGE_TWO = { id: "img_2", url: "data:image/webp;base64,two", position: 2 }
const IMAGE_THREE = { id: "img_3", url: "data:image/webp;base64,three", position: 3 }

describe("keyframesFor", () => {
  it("returns the single image url when there is exactly one source", () => {
    expect(keyframesFor({ sourceImages: [IMAGE_ONE], prompt: "p", duration: 5, aspectRatio: "16:9" })).toBe(
      "data:image/webp;base64,one",
    )
  })

  it("spreads three images across the duration as deterministic timestamps", () => {
    expect(
      keyframesFor({ sourceImages: [IMAGE_ONE, IMAGE_TWO, IMAGE_THREE], prompt: "p", duration: 10, aspectRatio: "16:9" }),
    ).toEqual([
      [0, "data:image/webp;base64,one"],
      [5, "data:image/webp;base64,two"],
      [10, "data:image/webp;base64,three"],
    ])
  })
})

describe("minimumDurationForSources", () => {
  it("never drops below 5 seconds", () => {
    expect(minimumDurationForSources(1)).toBe(5)
    expect(minimumDurationForSources(3)).toBe(5)
    expect(minimumDurationForSources(6)).toBe(5)
    expect(minimumDurationForSources(8)).toBe(7)
  })
})

describe("FluxVideoProvider.create", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("exposes its provider name and model", () => {
    const provider = new FluxVideoProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-3-video" })
    expect(provider.name).toBe("bfl")
    expect(provider.model).toBe("flux-3-video")
  })

  it("sends a single image url as keyframes and carries polling_url only in metadata", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "req_1", polling_url: "https://api.bfl.ai/v1/get_result?id=req_1" }))
    const provider = new FluxVideoProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-3-video" })

    const result = await provider.create({ sourceImages: [IMAGE_ONE], prompt: "Cinematic", duration: 5, aspectRatio: "16:9" })

    const [submitUrl, submitInit] = fetchMock.mock.calls[0]
    expect(submitUrl).toBe("https://api.bfl.ai/v1/flux-3-video")
    expect(submitInit.headers["x-key"]).toBe("secret-key")
    const body = JSON.parse(submitInit.body)
    expect(body.keyframes).toBe("data:image/webp;base64,one")
    expect(body.mode).toBe("i2v")
    expect(body.duration).toBe(5)
    expect(body.resolution).toBe("hd")
    expect(body.generate_audio).toBe(true)
    expect(body.aspect_ratio).toBe("16:9")

    expect(result.taskId).toBe("req_1")
    expect(result.taskMetadata).toEqual({ pollingUrl: "https://api.bfl.ai/v1/get_result?id=req_1", bflCredits: null })
    expect(JSON.stringify(result.taskId)).not.toContain("polling")
  })

  it.each([
    ["16:9", "16:9"],
    ["9:16", "9:16"],
    ["1:1", "1:1"],
    ["4:5", "4:5"],
    ["4:3", "4:3"],
    ["3:4", "3:4"],
  ] as const)("submits a defined aspect_ratio for %s", async (aspectRatio, expected) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "req_ar", polling_url: "https://api.bfl.ai/v1/get_result?id=req_ar" }))
    const provider = new FluxVideoProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-3-video" })

    await provider.create({ sourceImages: [IMAGE_ONE], prompt: "Cinematic", duration: 5, aspectRatio })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.aspect_ratio).toBe(expected)
    expect(body.aspect_ratio).toBeDefined()
  })

  it("sends three images over 10 seconds as spread keyframe tuples", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "req_2", polling_url: "https://api.bfl.ai/v1/get_result?id=req_2" }))
    const provider = new FluxVideoProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-3-video" })

    await provider.create({ sourceImages: [IMAGE_ONE, IMAGE_TWO, IMAGE_THREE], prompt: "Cinematic", duration: 10, aspectRatio: "16:9" })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.keyframes).toEqual([
      [0, "data:image/webp;base64,one"],
      [5, "data:image/webp;base64,two"],
      [10, "data:image/webp;base64,three"],
    ])
    expect(body.duration).toBe(10)
  })

  it("rejects a non-integer duration", async () => {
    const provider = new FluxVideoProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-3-video" })
    await expect(
      provider.create({ sourceImages: [IMAGE_ONE], prompt: "p", duration: 5.5, aspectRatio: "16:9" }),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a duration below the minimum required for the source count", async () => {
    const provider = new FluxVideoProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-3-video" })
    await expect(
      provider.create({
        sourceImages: [IMAGE_ONE, IMAGE_TWO, IMAGE_THREE, IMAGE_ONE, IMAGE_TWO, IMAGE_THREE, IMAGE_ONE, IMAGE_TWO, IMAGE_THREE],
        prompt: "p",
        duration: 5,
        aspectRatio: "16:9",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("FluxVideoProvider.getStatus", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function providerWith(status: number, body: unknown) {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body))
    return new FluxVideoProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-3-video" })
  }

  const meta = { pollingUrl: "https://api.bfl.ai/v1/get_result?id=req_1" }

  it("requires a polling url in task metadata", async () => {
    const provider = new FluxVideoProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-3-video" })
    await expect(provider.getStatus("req_1")).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" })
    await expect(provider.getStatus("req_1", {})).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("maps Pending to queued with bounded progress", async () => {
    const provider = providerWith(200, { status: "Pending" })
    const status = await provider.getStatus("req_1", meta)
    expect(status.state).toBe("QUEUED")
    expect(status.progress).toBeGreaterThanOrEqual(0)
    expect(status.progress).toBeLessThanOrEqual(100)
    const [pollUrl, pollInit] = fetchMock.mock.calls[0]
    expect(pollUrl).toBe(meta.pollingUrl)
    expect(pollInit.headers["x-key"]).toBe("secret-key")
  })

  it("maps Reasoning and Generating to running with bounded progress", async () => {
    const reasoning = providerWith(200, { status: "Reasoning" })
    const reasoningStatus = await reasoning.getStatus("req_1", meta)
    expect(reasoningStatus.state).toBe("RUNNING")
    expect(reasoningStatus.progress).toBeGreaterThanOrEqual(0)
    expect(reasoningStatus.progress).toBeLessThanOrEqual(100)

    const generating = providerWith(200, { status: "Generating" })
    const generatingStatus = await generating.getStatus("req_1", meta)
    expect(generatingStatus.state).toBe("RUNNING")
    expect(generatingStatus.progress).toBeGreaterThanOrEqual(0)
    expect(generatingStatus.progress).toBeLessThanOrEqual(100)
  })

  it("maps Ready to succeeded reading result.sample", async () => {
    const provider = providerWith(200, { status: "Ready", result: { sample: "https://signed.example/video.mp4?sig=abc" } })
    await expect(provider.getStatus("req_1", meta)).resolves.toEqual({
      state: "SUCCEEDED",
      outputUrl: "https://signed.example/video.mp4?sig=abc",
    })
  })

  it("maps moderation to PROVIDER_MODERATED", async () => {
    const provider = providerWith(200, { status: "Content Moderated" })
    await expect(provider.getStatus("req_1", meta)).resolves.toEqual({ state: "FAILED", errorCode: "PROVIDER_MODERATED" })
  })

  it("maps Error to VIDEO_PROVIDER_FAILED", async () => {
    const provider = providerWith(200, { status: "Error" })
    await expect(provider.getStatus("req_1", meta)).resolves.toEqual({ state: "FAILED", errorCode: "VIDEO_PROVIDER_FAILED" })
  })
})
