import { describe, expect, it, vi } from "vitest"

import { VideoProviderError } from "./errors"
import { RunwayVideoProvider } from "./runway"

describe("RunwayVideoProvider", () => {
  it("exposes its provider name and model", () => {
    const provider = new RunwayVideoProvider({ imageToVideo: { create: vi.fn() }, tasks: { retrieve: vi.fn() } }, "gen4.5")
    expect(provider.name).toBe("runway")
    expect(provider.model).toBe("gen4.5")
  })

  it("maps a single source image into an image-to-video task", async () => {
    const create = vi.fn().mockResolvedValue({ id: "task_1" })
    const provider = new RunwayVideoProvider({ imageToVideo: { create }, tasks: { retrieve: vi.fn() } }, "gen4.5")
    const result = await provider.create({
      sourceImages: [{ id: "img_1", url: "https://cdn.example/source.webp", position: 1 }],
      prompt: "Slow cinematic orbit",
      duration: 5,
      aspectRatio: "16:9",
    })
    expect(result).toEqual({ taskId: "task_1" })
    expect(create).toHaveBeenCalledWith({
      model: "gen4.5",
      promptImage: "https://cdn.example/source.webp",
      promptText: "Slow cinematic orbit",
      duration: 5,
      ratio: "1280:720",
    })
  })

  it("rejects multi-source requests with MULTI_IMAGE_REQUIRES_FLUX before submission", async () => {
    const create = vi.fn().mockResolvedValue({ id: "task_1" })
    const provider = new RunwayVideoProvider({ imageToVideo: { create }, tasks: { retrieve: vi.fn() } }, "gen4.5")
    await expect(
      provider.create({
        sourceImages: [
          { id: "img_1", url: "https://cdn.example/one.webp", position: 1 },
          { id: "img_2", url: "https://cdn.example/two.webp", position: 2 },
        ],
        prompt: "Multi keyframe",
        duration: 10,
        aspectRatio: "16:9",
      }),
    ).rejects.toMatchObject({ safeCode: "MULTI_IMAGE_REQUIRES_FLUX" })
    expect(create).not.toHaveBeenCalled()
  })

  it("normalizes running progress without fabricating it", async () => {
    const retrieve = vi.fn().mockResolvedValue({ status: "RUNNING", progress: 0.42 })
    const provider = new RunwayVideoProvider({ imageToVideo: { create: vi.fn() }, tasks: { retrieve } }, "gen4.5")
    await expect(provider.getStatus("task_1")).resolves.toEqual({ state: "RUNNING", progress: 42 })
  })

  it("returns a safe failure code without the raw provider message", async () => {
    const retrieve = vi.fn().mockResolvedValue({ status: "FAILED", failure: "Authorization Bearer secret", failureCode: "SAFETY.CONTENT" })
    const provider = new RunwayVideoProvider({ imageToVideo: { create: vi.fn() }, tasks: { retrieve } }, "gen4.5")
    const status = await provider.getStatus("task_1")
    expect(status).toEqual({ state: "FAILED", errorCode: "PROVIDER_REJECTED" })
    expect(JSON.stringify(status)).not.toContain("secret")
    expect(new VideoProviderError("X")).toBeInstanceOf(Error)
  })
})
