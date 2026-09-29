import { describe, expect, it, vi } from "vitest"

import { GoogleImageProvider } from "./google"

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const input = { projectId: "project_1", imageId: "image_1", position: 1, prompt: "Premium product prompt" }
const PNG_B64 = Buffer.from([137, 80, 78, 71]).toString("base64")

function imageResponse() {
  return jsonResponse(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }] })
}

describe("GoogleImageProvider (Gemini image models)", () => {
  it("calls generateContent with the key header, an image-only response and the frame shape", async () => {
    const fetchMock: FetchMock = vi.fn().mockResolvedValue(imageResponse())
    const provider = new GoogleImageProvider({ apiKey: "AIza-test", model: "gemini-3.1-flash-image", fetch: fetchMock as unknown as typeof fetch })
    const result = await provider.generateImage({ ...input, format: "9:16" })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent")
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test")
    const body = JSON.parse(String(init.body))
    expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16", imageSize: "2K" } })
    expect(result).toMatchObject({ provider: "google", model: "gemini-3.1-flash-image", contentType: "image/png" })
    expect(Array.from(result.bytes)).toEqual([137, 80, 78, 71])
  })

  it("sends product photos as inline image parts and asks for the exact product", async () => {
    const fetchMock: FetchMock = vi.fn().mockResolvedValue(imageResponse())
    const provider = new GoogleImageProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch })
    await provider.generateImage({ ...input, referenceImages: [`data:image/jpeg;base64,${PNG_B64}`] })
    const parts = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).contents[0].parts
    expect(parts[0].text).toMatch(/^The product in image 1 is the exact product/)
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/jpeg", data: PNG_B64 } })
  })

  it("maps a retired Imagen model to the current default instead of failing a paid run", () => {
    const provider = new GoogleImageProvider({ apiKey: "k", model: "imagen-3.0-generate-002", fetch: vi.fn() as unknown as typeof fetch })
    expect((provider as unknown as { model: string }).model).toBe("gemini-3.1-flash-image")
  })

  it("maps a blocked prompt or a safety finish to PROVIDER_MODERATED", async () => {
    const blocked = new GoogleImageProvider({ apiKey: "k", fetch: vi.fn().mockResolvedValue(jsonResponse(200, { promptFeedback: { blockReason: "SAFETY" } })) as unknown as typeof fetch })
    await expect(blocked.generateImage(input)).rejects.toMatchObject({ code: "PROVIDER_MODERATED" })
    const finished = new GoogleImageProvider({ apiKey: "k", fetch: vi.fn().mockResolvedValue(jsonResponse(200, { candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] })) as unknown as typeof fetch })
    await expect(finished.generateImage(input)).rejects.toMatchObject({ code: "PROVIDER_MODERATED" })
  })

  it.each([401, 403])("maps HTTP %i to PROVIDER_AUTHENTICATION_FAILED without leaking the body", async (status) => {
    const provider = new GoogleImageProvider({ apiKey: "k", fetch: vi.fn().mockResolvedValue(jsonResponse(status, { error: { message: "key AIza-secret invalid" } })) as unknown as typeof fetch })
    const failure = (await provider.generateImage(input).catch((error: Error) => error)) as Error
    expect(failure).toMatchObject({ code: "PROVIDER_AUTHENTICATION_FAILED" })
    expect(String(failure.message)).not.toContain("AIza-secret")
  })

  it("rejects a response with no image", async () => {
    const provider = new GoogleImageProvider({ apiKey: "k", fetch: vi.fn().mockResolvedValue(jsonResponse(200, { candidates: [{ content: { parts: [{ text: "no" }] } }] })) as unknown as typeof fetch })
    await expect(provider.generateImage(input)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" })
  })
})
