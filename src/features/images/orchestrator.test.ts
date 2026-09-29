import { describe, expect, it, vi } from "vitest"

import { processNextImage, startImageRun, type ImageRunRepository } from "./orchestrator"
import { BflProviderError } from "@/lib/providers/bfl"
import type { ImageGenerationResult } from "@/lib/providers/images/types"

type ImageRecord = {
  id: string
  projectId: string
  position: number
  status: "PENDING" | "GENERATING" | "COMPLETED" | "FAILED"
  imagePrompt: string
  attempts: number
  provider?: string
  model?: string
}

function memoryRepository(targetImageCount = 3): ImageRunRepository & { images: ImageRecord[] } {
  const repository = {
    images: [] as ImageRecord[],
    async getOwnedDirections() {
      return {
        targetImageCount,
        directions: Array.from({ length: targetImageCount }, (_, index) => ({ id: `direction_${index + 1}`, position: index + 1, imagePrompt: `Prompt ${index + 1}` })),
      }
    },
    async createPendingImages(projectId: string, directions: Array<{ id: string; position: number; imagePrompt: string }>) {
      repository.images = directions.map((direction) => ({ id: `image_${direction.position}`, projectId, position: direction.position, status: "PENDING" as const, imagePrompt: direction.imagePrompt, attempts: 0 }))
      return repository.images
    },
    async claimNextPendingImage(projectId: string) {
      if (repository.images.some((image) => image.projectId === projectId && image.status === "GENERATING")) return null
      const image = repository.images.find((item) => item.projectId === projectId && item.status === "PENDING")
      if (!image) return null
      image.status = "GENERATING"
      image.attempts += 1
      return { ...image }
    },
    async completeImage(imageId: string, completion: { provider: string; model: string }) {
      const image = repository.images.find((item) => item.id === imageId)!
      image.status = "COMPLETED"
      image.provider = completion.provider
      image.model = completion.model
    },
    async failImage(imageId: string) {
      const image = repository.images.find((item) => item.id === imageId)!
      image.status = "FAILED"
    },
    async summarize(projectId: string) {
      return repository.images.filter((image) => image.projectId === projectId).map(({ position, status }) => ({ position, status }))
    },
  }
  return repository
}

describe("sequential image orchestration", () => {
  it("never generates image 02 before image 01 completes", async () => {
    const repository = memoryRepository()
    const provider = { generateImage: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", provider: "openai", model: "gpt-image-1.5", providerAssetId: "asset_1" }) }
    const storage = { put: vi.fn().mockResolvedValue({ url: "https://cdn.example/image.png", etag: "etag" }) }

    await startImageRun("project_1", "user_1", { repository })
    expect(repository.images.map((image) => image.status)).toEqual(["PENDING", "PENDING", "PENDING"])
    await processNextImage("project_1", { repository, provider, storage })

    expect(provider.generateImage).toHaveBeenCalledTimes(1)
    expect(provider.generateImage.mock.calls[0][0].position).toBe(1)
    expect(repository.images.map((image) => image.status)).toEqual(["COMPLETED", "PENDING", "PENDING"])
  })

  it("creates and processes exactly the snapshotted image count sequentially", async () => {
    const repository = memoryRepository(3)
    const provider = { generateImage: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", provider: "openai", model: "gpt-image-1.5", providerAssetId: "asset_1" }) }
    const storage = { put: vi.fn().mockResolvedValue({ url: "https://cdn.example/image.png", etag: "etag" }) }

    await startImageRun("project_1", "user_1", { repository })
    await processNextImage("project_1", { repository, provider, storage })
    await processNextImage("project_1", { repository, provider, storage })
    await processNextImage("project_1", { repository, provider, storage })

    expect(provider.generateImage.mock.calls.map(([input]) => input.position)).toEqual([1, 2, 3])
    expect(repository.images).toHaveLength(3)
    expect(repository.images.map((image) => image.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED"])
  })

  it("does not overlap concurrent claims", async () => {
    const repository = memoryRepository()
    const release: { current?: () => void } = {}
    const provider = { generateImage: vi.fn(() => new Promise<ImageGenerationResult>((resolve) => { release.current = () => resolve({ bytes: new Uint8Array([1]), contentType: "image/png", provider: "openai", model: "gpt-image-1.5" }) })) }
    const storage = { put: vi.fn().mockResolvedValue({ url: "https://cdn.example/image.png" }) }
    await startImageRun("project_1", "user_1", { repository })

    const first = processNextImage("project_1", { repository, provider, storage })
    const second = processNextImage("project_1", { repository, provider, storage })
    await Promise.resolve()
    expect(provider.generateImage).toHaveBeenCalledTimes(1)
    release.current?.()
    await Promise.all([first, second])
  })

  it("keeps completed siblings when a later image fails", async () => {
    const repository = memoryRepository()
    const provider = { generateImage: vi.fn().mockResolvedValueOnce({ bytes: new Uint8Array([1]), contentType: "image/png", provider: "openai", model: "gpt-image-1.5" }).mockRejectedValueOnce(new Error("raw provider secret")) }
    const storage = { put: vi.fn().mockResolvedValue({ url: "https://cdn.example/image.png" }) }
    await startImageRun("project_1", "user_1", { repository })
    await processNextImage("project_1", { repository, provider, storage })
    await processNextImage("project_1", { repository, provider, storage })
    expect(repository.images.map((image) => image.status)).toEqual(["COMPLETED", "FAILED", "PENDING"])
  })

  it("persists the provider and model reported by the active provider", async () => {
    const repository = memoryRepository(1)
    const provider = { generateImage: vi.fn().mockResolvedValue({ bytes: new Uint8Array([9]), contentType: "image/webp", provider: "bfl", model: "flux-2-pro", providerAssetId: "req_1" }) }
    const storage = { put: vi.fn().mockResolvedValue({ url: "https://cdn.example/image.webp" }) }
    await startImageRun("project_1", "user_1", { repository })
    await processNextImage("project_1", { repository, provider, storage })
    expect(repository.images[0].provider).toBe("bfl")
    expect(repository.images[0].model).toBe("flux-2-pro")
  })

  it("maps a BflProviderError code into a safe failure category", async () => {
    const repository = memoryRepository(1)
    const failed: string[] = []
    repository.failImage = async (imageId: string, safeErrorCode: string) => {
      const image = repository.images.find((item) => item.id === imageId)!
      image.status = "FAILED"
      failed.push(safeErrorCode)
    }
    const provider = { generateImage: vi.fn().mockRejectedValue(new BflProviderError("PROVIDER_RATE_LIMIT", 429)) }
    const storage = { put: vi.fn() }
    await startImageRun("project_1", "user_1", { repository })
    await processNextImage("project_1", { repository, provider, storage }, undefined, { sleep: async () => {} })
    expect(repository.images[0].status).toBe("FAILED")
    expect(failed).toEqual(["PROVIDER_RATE_LIMIT"])
    // Rate-limited requests are not billed: asked exactly once more, never in a loop.
    expect(provider.generateImage).toHaveBeenCalledTimes(2)
  })

  it("moves a shot FLUX refused to Nano Banana 2 and tells the run to stay there", async () => {
    const repository = memoryRepository(1)
    const provider = { generateImage: vi.fn().mockRejectedValue(new BflProviderError("PROVIDER_MODERATED", 200, "Protected Content")) }
    const fallback = { generateImage: vi.fn().mockResolvedValue({ bytes: new Uint8Array([7]), contentType: "image/png", provider: "google", model: "gemini-3.1-flash-image", providerAssetId: "g_1" }) }
    const storage = { put: vi.fn().mockResolvedValue({ url: "https://cdn.example/image.png" }) }
    const onFallback = vi.fn()
    await startImageRun("project_1", "user_1", { repository })
    await processNextImage("project_1", { repository, provider, storage }, { provider: "bfl", model: "flux-2-pro" }, { fallbackProvider: async () => fallback, onFallback })
    expect(provider.generateImage).toHaveBeenCalledOnce()
    expect(repository.images[0].status).toBe("COMPLETED")
    expect(repository.images[0].provider).toBe("google")
    expect(onFallback).toHaveBeenCalledWith({ provider: "google", model: "gemini-3.1-flash-image" })
  })

  it("fails a refused shot plainly when no fallback model is configured", async () => {
    const repository = memoryRepository(1)
    const failed: string[] = []
    repository.failImage = async (imageId: string, safeErrorCode: string) => {
      repository.images.find((item) => item.id === imageId)!.status = "FAILED"
      failed.push(safeErrorCode)
    }
    const provider = { generateImage: vi.fn().mockRejectedValue(new BflProviderError("PROVIDER_MODERATED", 200)) }
    await startImageRun("project_1", "user_1", { repository })
    await processNextImage("project_1", { repository, provider, storage: { put: vi.fn() } }, undefined, { fallbackProvider: async () => null })
    expect(failed).toEqual(["PROVIDER_MODERATED"])
    expect(provider.generateImage).toHaveBeenCalledOnce()
  })
})
