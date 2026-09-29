import { describe, expect, it, vi } from "vitest"

import { KlingVideoProvider, klingError, klingImage } from "./kling"
import { VeoVideoProvider } from "./veo"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
const frame = (n: number) => ({ id: `i${n}`, url: `data:image/jpeg;base64,FRAME${n}`, position: n })

describe("VeoVideoProvider", () => {
  it("uses product photos as asset references at 8 s", async () => {
    const fetch = vi.fn(async () => json({ name: "models/veo-3.1-fast-generate-preview/operations/op1" }))
    const veo = new VeoVideoProvider({ apiKey: "k", model: "veo-3.1-fast-generate-preview", fetch: fetch as never })
    const task = await veo.create({ sourceImages: [frame(1)], referenceImages: ["data:image/jpeg;base64,PRODUCT"], prompt: "Reel", duration: 8, aspectRatio: "9:16" })
    expect(task.taskId).toBe("models/veo-3.1-fast-generate-preview/operations/op1")
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning")
    const body = JSON.parse(String(init.body))
    expect(body.instances[0].referenceImages).toEqual([
      { image: { bytesBase64Encoded: "FRAME1", mimeType: "image/jpeg" }, referenceType: "asset" },
      { image: { bytesBase64Encoded: "PRODUCT", mimeType: "image/jpeg" }, referenceType: "asset" },
    ])
    expect(body.parameters).toEqual({ aspectRatio: "9:16", durationSeconds: 8, resolution: "720p" })
  })

  it("uses first and last frames for shorter multi-scene clips", async () => {
    const fetch = vi.fn(async () => json({ name: "models/veo-3.1-fast-generate-preview/operations/op2" }))
    const veo = new VeoVideoProvider({ apiKey: "k", fetch: fetch as never })
    await veo.create({ sourceImages: [frame(1), frame(2), frame(3)], referenceImages: ["data:image/jpeg;base64,P"], prompt: "Reel", duration: 6, aspectRatio: "16:9" })
    const instance = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)).instances[0]
    expect(instance.image).toEqual({ bytesBase64Encoded: "FRAME1", mimeType: "image/jpeg" })
    expect(instance.lastFrame.bytesBase64Encoded).toBe("FRAME3")
    expect(instance.referenceImages).toBeUndefined()
  })

  it("falls back once to the opening frame when Google refuses a richer mode", async () => {
    const responses = [
      json({ error: { status: "INVALID_ARGUMENT", message: "Your use case is currently not supported." } }, 400),
      json({ name: "models/veo-3.1-lite-generate-preview/operations/op3" }),
    ]
    const fetch = vi.fn(async () => responses.shift()!)
    const veo = new VeoVideoProvider({ apiKey: "k", model: "veo-3.1-lite-generate-preview", fetch: fetch as never })
    const task = await veo.create({ sourceImages: [frame(1), frame(2)], prompt: "Reel", duration: 4, aspectRatio: "9:16" })
    expect(task.taskMetadata).toMatchObject({ mode: "first (fallback)" })
    const retry = JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body)).instances[0]
    expect(retry.lastFrame).toBeUndefined()
    expect(retry.image.bytesBase64Encoded).toBe("FRAME1")
  })

  it("refuses what Veo cannot do before any call, and maps a retired model to the default", async () => {
    const fetch = vi.fn()
    const veo = new VeoVideoProvider({ apiKey: "k", model: "veo-3.0-generate", fetch: fetch as never })
    expect(veo.model).toBe("veo-3.1-fast-generate-preview")
    await expect(veo.create({ sourceImages: [frame(1)], prompt: "x", duration: 5, aspectRatio: "9:16" })).rejects.toThrow("DURATION_UNSUPPORTED")
    await expect(veo.create({ sourceImages: [frame(1)], prompt: "x", duration: 8, aspectRatio: "1:1" })).rejects.toThrow("ASPECT_RATIO_UNSUPPORTED")
    await expect(veo.create({ sourceImages: [frame(1)], prompt: "x", duration: 6, aspectRatio: "9:16", resolution: "1080p" })).rejects.toThrow("RESOLUTION_UNSUPPORTED")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("reads operation results, filtered renders, and downloads with the key", async () => {
    const responses = [
      json({ done: false }),
      json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media" } }] } } }),
      json({ done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1 } } }),
      new Response(new Uint8Array([1, 2, 3])),
    ]
    const fetch = vi.fn(async () => responses.shift()!)
    const veo = new VeoVideoProvider({ apiKey: "secret", fetch: fetch as never })
    const op = "models/veo-3.1-fast-generate-preview/operations/op1"
    await expect(veo.getStatus(op)).resolves.toEqual({ state: "RUNNING" })
    const done = await veo.getStatus(op)
    expect(done).toMatchObject({ state: "SUCCEEDED" })
    await expect(veo.getStatus(op)).resolves.toEqual({ state: "FAILED", errorCode: "PROVIDER_MODERATED" })
    const file = await veo.download(done.outputUrl!)
    expect(Array.from(file.bytes)).toEqual([1, 2, 3])
    expect((fetch.mock.calls[3] as unknown as [string, RequestInit])[1].headers).toEqual({ "x-goog-api-key": "secret" })
    await expect(veo.download("https://evil.example/x")).rejects.toThrow()
  })
})

describe("KlingVideoProvider", () => {
  it("sends first and last frames as raw Base64 with native audio and the Bearer key", async () => {
    const fetch = vi.fn(async () => json({ code: 0, data: { id: "t1" } }))
    const kling = new KlingVideoProvider({ apiKey: "kl-key", model: "kling-3.0", fetch: fetch as never })
    const task = await kling.create({ sourceImages: [frame(1), frame(2)], prompt: "Reel", duration: 10, aspectRatio: "9:16" })
    expect(task).toEqual({ taskId: "t1", taskMetadata: { resolution: "720p", duration: 10 } })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api-singapore.klingai.com/image-to-video/kling-3.0")
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer kl-key")
    const body = JSON.parse(String(init.body))
    expect(body.contents).toEqual([
      { type: "prompt", text: "Reel" },
      { type: "first_frame", url: "FRAME1" },
      { type: "last_frame", url: "FRAME2" },
    ])
    expect(body.settings).toEqual({ resolution: "720p", duration: 10, audio: "native", multi_shot: false })
  })

  it("Turbo has no audio switch or closing frame", async () => {
    const fetch = vi.fn(async () => json({ code: 0, data: { id: "t2" } }))
    const kling = new KlingVideoProvider({ apiKey: "k", model: "kling-3.0-turbo", fetch: fetch as never })
    await kling.create({ sourceImages: [frame(1), frame(2)], prompt: "Reel", duration: 5, aspectRatio: "9:16" })
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.settings).toEqual({ resolution: "720p", duration: 5 })
    expect(body.contents.map((item: { type: string }) => item.type)).toEqual(["prompt", "first_frame"])
  })

  it("maps task states and Kling service codes", async () => {
    const responses = [
      json({ code: 0, data: [{ id: "t", status: "processing" }] }),
      json({ code: 0, data: [{ id: "t", status: "succeeded", outputs: [{ type: "video", url: "https://kling/out.mp4" }] }] }),
      json({ code: 0, data: [{ id: "t", status: "failed", message: "Triggered content risk control" }] }),
      json({ code: 1102, message: "Resource pack exhausted" }, 429),
    ]
    const kling = new KlingVideoProvider({ apiKey: "k", fetch: (async () => responses.shift()!) as never })
    await expect(kling.getStatus("t")).resolves.toEqual({ state: "RUNNING" })
    await expect(kling.getStatus("t")).resolves.toEqual({ state: "SUCCEEDED", outputUrl: "https://kling/out.mp4" })
    await expect(kling.getStatus("t")).resolves.toEqual({ state: "FAILED", errorCode: "PROVIDER_MODERATED" })
    await expect(kling.getStatus("t")).rejects.toThrow("PROVIDER_BILLING")
    expect(klingError(401, 1002)).toBe("PROVIDER_AUTHENTICATION_FAILED")
    expect(klingError(403, 1103)).toBe("PROVIDER_MODEL_NOT_ACTIVATED")
    expect(klingImage("https://cdn/x.jpg")).toBe("https://cdn/x.jpg")
  })
})
