import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FluxImageProvider } from "./flux"

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function imageResponse(bytes: Uint8Array): Response {
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: { "content-type": "image/webp" } })
}

async function flushPolling(iterations = 300) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(8_000)
  }
}

describe("FluxImageProvider", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("does not retry a refusal on its own: it reports the reason and the charge, and the user decides", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: "a", polling_url: "https://api.bfl.ai/v1/get_result?id=a", cost: 12 }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "a", status: "Request Moderated", result: null, details: { "Moderation Reasons": ["Protected Content"] } }))
    const provider = new FluxImageProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-2-pro" })

    const pending = provider.generateImage({ projectId: "p", imageId: "i", position: 1, prompt: "Scene", referenceImages: ["https://media.example/ref.jpg"] }).catch((error) => error)
    await flushPolling()
    const error = await pending
    expect(error.code).toBe("PROVIDER_MODERATED")
    expect(error.message).toContain("Protected Content")
    expect(error.costUsd).toBe(0.12)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).prompt).not.toMatch(/logo/i)
  })

  it("submits, polls, downloads the sample, and returns bytes with provider metadata", async () => {
    const sampleBytes = new Uint8Array([1, 2, 3, 4])
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: "req_1", polling_url: "https://api.bfl.ai/v1/get_result?id=req_1" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "Ready", result: { sample: "https://signed.example/sample.webp?sig=abc" } }))
      .mockResolvedValueOnce(imageResponse(sampleBytes))

    const provider = new FluxImageProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-2-pro" })

    const pending = provider.generateImage({ projectId: "project_1", imageId: "image_1", position: 1, prompt: "Premium product prompt" })
    await flushPolling()
    const result = await pending

    // Submission body and endpoint
    const [submitUrl, submitInit] = fetchMock.mock.calls[0]
    expect(submitUrl).toBe("https://api.bfl.ai/v1/flux-2-pro")
    expect(submitInit.method).toBe("POST")
    expect(submitInit.headers["x-key"]).toBe("secret-key")
    expect(JSON.parse(submitInit.body)).toEqual({
      prompt: "Premium product prompt",
      width: 1536,
      height: 1024,
      output_format: "jpeg",
    })

    // Poll uses the returned URL with the API key
    const [pollUrl, pollInit] = fetchMock.mock.calls[1]
    expect(pollUrl).toBe("https://api.bfl.ai/v1/get_result?id=req_1")
    expect(pollInit.headers["x-key"]).toBe("secret-key")

    // Download the signed sample WITHOUT forwarding the key
    const [downloadUrl, downloadInit] = fetchMock.mock.calls[2]
    expect(downloadUrl).toBe("https://signed.example/sample.webp?sig=abc")
    const downloadHeaders = (downloadInit?.headers ?? {}) as Record<string, string>
    expect(downloadHeaders["x-key"]).toBeUndefined()

    expect(result.bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4])
    expect(result.contentType).toBe("image/webp")
    expect(result.provider).toBe("bfl")
    expect(result.model).toBe("flux-2-pro")
    expect(result.providerAssetId).toBe("req_1")
    expect(result.width).toBe(1536)
    expect(result.height).toBe(1024)
  })

  it("rejects a downloaded sample that is not an image content type", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: "req_1", polling_url: "https://api.bfl.ai/v1/get_result?id=req_1" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "Ready", result: { sample: "https://signed.example/sample.webp" } }))
      .mockResolvedValueOnce(new Response("<html>expired</html>", { status: 200, headers: { "content-type": "text/html" } }))

    const provider = new FluxImageProvider({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, model: "flux-2-pro" })

    const pending = provider.generateImage({ projectId: "project_1", imageId: "image_1", position: 1, prompt: "Premium product prompt" })
    const assertion = expect(pending).rejects.toMatchObject({ code: "PROVIDER_DOWNLOAD_FAILED" })
    await flushPolling()
    await assertion
  })
})

describe("FLUX.2 product references", () => {
  it("names reference fields the way the FLUX.2 API expects", async () => {
    const { referenceFields } = await import("./flux")
    expect(referenceFields(["a", "b", "c"])).toEqual({ input_image: "a", input_image_2: "b", input_image_3: "c" })
    expect(referenceFields([])).toEqual({})
  })

  it("tells the model the attached photos are the exact product", async () => {
    const { withProductReference } = await import("./types")
    expect(withProductReference("A beach scene.", 0)).toBe("A beach scene.")
    expect(withProductReference("A beach scene.", 1)).toMatch(/^The product in image 1 is the exact product/)
    expect(withProductReference("A beach scene.", 3)).toContain("images 1-3")
    expect(withProductReference("A beach scene.", 3)).toMatch(/A beach scene\.$/)
    // BFL refuses "reproduce … logo placement" as Protected Content; the neutral
    // wording used for FLUX and OpenAI must not ask to copy a logo or design.
    const neutral = withProductReference("A beach scene.", 2, "neutral")
    expect(neutral).toMatch(/^Use the product shown in the reference images/)
    expect(neutral).not.toMatch(/logo|reproduce|redesign/i)
    expect(neutral).toMatch(/A beach scene\.$/)
  })
})
