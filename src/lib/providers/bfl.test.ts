import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BflClient, BflProviderError } from "./bfl"

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/**
 * Advances fake timers repeatedly so awaited backoff delays inside the polling
 * loop settle without leaving the test hanging on real time.
 */
async function flushPolling(iterations = 300) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(8_000)
  }
}

describe("BflClient", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("submits a request and reads id and polling_url", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "req_1", polling_url: "https://api.bfl.ai/v1/get_result?id=req_1" }))
    const client = new BflClient({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch })

    const submission = await client.submit("flux-2-pro", { prompt: "Premium product prompt" })

    expect(submission).toEqual({ id: "req_1", pollingUrl: "https://api.bfl.ai/v1/get_result?id=req_1" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.bfl.ai/v1/flux-2-pro")
    expect(init.method).toBe("POST")
    expect(init.headers["x-key"]).toBe("secret-key")
    expect(init.headers["content-type"]).toBe("application/json")
    expect(JSON.parse(init.body)).toEqual({ prompt: "Premium product prompt" })
  })

  it("polls through Pending, Reasoning, and Generating before Ready returns result.sample", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { status: "Pending" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "Reasoning" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "Generating" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "Ready", result: { sample: "https://signed.example/sample.webp" } }))
    const client = new BflClient({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch })

    const pending = client.poll("https://api.bfl.ai/v1/get_result?id=req_1")
    await flushPolling()
    await expect(pending).resolves.toEqual({ sample: "https://signed.example/sample.webp" })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const pollHeaders = fetchMock.mock.calls[0][1].headers
    expect(pollHeaders["x-key"]).toBe("secret-key")
  })

  it("accepts BFL's real pending shape, where result, progress and details are null", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: "req_1", status: "Pending", result: null, progress: null, details: null }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "req_1", status: "Ready", result: { sample: "https://signed.example/s.jpeg", prompt: "p", seed: 1 }, progress: null }))
    const client = new BflClient({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch })

    const pending = client.poll("https://api.bfl.ai/v1/get_result?id=req_1")
    await flushPolling()
    await expect(pending).resolves.toEqual({ sample: "https://signed.example/s.jpeg" })
  })

  it("reads the credit cost from a submission, and accepts a null or missing one", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: "a", polling_url: "https://api.bfl.ai/v1/get_result?id=a", cost: 7, input_mp: 1.2, output_mp: 2.1 }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "b", polling_url: "https://api.bfl.ai/v1/get_result?id=b", cost: null }))
    const client = new BflClient({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch })

    await expect(client.submit("flux-2-pro", { prompt: "p" })).resolves.toMatchObject({ cost: 7 })
    await expect(client.submit("flux-2-pro", { prompt: "p" })).resolves.toMatchObject({ id: "b", cost: undefined })
  })

  it("names the field that did not match when a response is invalid, without its value", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "req_1", polling_url: "not a url" }))
    const client = new BflClient({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch })

    const error = await client.submit("flux-2-pro", { prompt: "p" }).catch((thrown) => thrown)
    expect(error.message).toContain("polling_url")
    expect(error.message).not.toContain("not a url")
  })

  it("maps a moderation result to PROVIDER_MODERATED", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: "Content Moderated" }))
    const client = new BflClient({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch })

    const pending = client.poll("https://api.bfl.ai/v1/get_result?id=req_1")
    const assertion = expect(pending).rejects.toMatchObject({ code: "PROVIDER_MODERATED" })
    await flushPolling()
    await assertion
  })

  it("maps a 401 submission to PROVIDER_AUTHENTICATION_FAILED", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
    const client = new BflClient({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch })

    await expect(client.submit("flux-2-pro", { prompt: "Premium product prompt" })).rejects.toMatchObject({
      code: "PROVIDER_AUTHENTICATION_FAILED",
      status: 401,
    })
  })

  it("maps a 429 submission to PROVIDER_RATE_LIMIT", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: "slow down" }))
    const client = new BflClient({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch })

    await expect(client.submit("flux-2-pro", { prompt: "Premium product prompt" })).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMIT",
      status: 429,
    })
  })

  it("maps an exceeded deadline to PROVIDER_TIMEOUT", async () => {
    // Return a fresh Response per call; a Response body can only be read once.
    fetchMock.mockImplementation(async () => jsonResponse(200, { status: "Pending" }))
    const client = new BflClient({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch, deadlineMs: 240_000 })

    const pending = client.poll("https://api.bfl.ai/v1/get_result?id=req_1")
    const assertion = expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" })
    await flushPolling()
    await assertion
  })

  it("never leaks raw provider bodies through the thrown error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "Bearer super-secret-token" }))
    const client = new BflClient({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch })

    const error = await client.submit("flux-2-pro", { prompt: "Premium product prompt" }).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(BflProviderError)
    expect(JSON.stringify({ message: error.message, code: error.code })).not.toContain("super-secret-token")
  })
})
