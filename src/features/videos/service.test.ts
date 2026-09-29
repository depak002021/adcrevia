import { describe, expect, it, vi } from "vitest"

import { multiImageRequiresFluxError } from "@/lib/providers/videos/errors"
import { refreshVideoStatus, startVideoGeneration, toVideoDto, VideoWorkflowError } from "./service"
import type { VideoRepository } from "./service"

const input = {
  projectId: "clx1234567890abcdefghijk",
  prompt: "Slow cinematic orbit with soft reflections",
  motionStyle: "CINEMATIC" as const,
  duration: 5 as const,
  aspectRatio: "16:9" as const,
}

function repository(overrides: Partial<VideoRepository> = {}): VideoRepository {
  return {
    getSelectedImages: vi.fn().mockResolvedValue([]),
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    createProcessingVideo: vi.fn(),
    getOwnedVideo: vi.fn(),
    updateStatus: vi.fn(),
    completeVideo: vi.fn(),
    ...overrides,
  }
}

function fluxProvider(overrides: Record<string, unknown> = {}) {
  return {
    name: "bfl" as const,
    model: "flux-3-video",
    create: vi.fn().mockResolvedValue({ taskId: "task_flux", taskMetadata: { pollingUrl: "https://poll.example/x" } }),
    getStatus: vi.fn(),
    ...overrides,
  }
}

function runwayProvider(overrides: Record<string, unknown> = {}) {
  return {
    name: "runway" as const,
    model: "gen4.5",
    create: vi.fn().mockResolvedValue({ taskId: "task_runway" }),
    getStatus: vi.fn(),
    ...overrides,
  }
}

describe("video generation service", () => {
  it("rejects generation when the project has no selected completed image", async () => {
    await expect(
      startVideoGeneration(input, "user_1", {
        provider: runwayProvider(),
        repository: repository({ getSelectedImages: vi.fn().mockResolvedValue([]) }),
      }),
    ).rejects.toMatchObject({ code: "SELECTED_IMAGE_REQUIRED" })
  })

  it("routes multi-source Runway requests to FLUX before any submission", async () => {
    const create = vi.fn(() => {
      throw multiImageRequiresFluxError()
    })
    await expect(
      startVideoGeneration(input, "user_1", {
        provider: runwayProvider({ create }),
        repository: repository({
          getSelectedImages: vi.fn().mockResolvedValue([
            { id: "image_1", url: "https://cdn.example/a.webp" },
            { id: "image_2", url: "https://cdn.example/b.webp" },
          ]),
        }),
      }),
    ).rejects.toMatchObject({ safeCode: "MULTI_IMAGE_REQUIRES_FLUX" })
  })

  it("passes ordered, prepared source images to FLUX", async () => {
    const create = vi.fn().mockResolvedValue({ taskId: "task_flux", taskMetadata: { pollingUrl: "https://poll.example/x" } })
    const createProcessingVideo = vi.fn().mockResolvedValue({ id: "video_1" })
    await startVideoGeneration(input, "user_1", {
      provider: fluxProvider({ create }),
      repository: repository({
        getSelectedImages: vi.fn().mockResolvedValue([
          { id: "image_1", url: "https://cdn.example/a.webp" },
          { id: "image_2", url: "https://cdn.example/b.webp" },
          { id: "image_3", url: "https://cdn.example/c.webp" },
        ]),
        createProcessingVideo,
      }),
    })
    expect(create).toHaveBeenCalledTimes(1)
    const submitted = create.mock.calls[0][0]
    expect(submitted.sourceImages).toEqual([
      { id: "image_1", url: "https://cdn.example/a.webp", position: 1 },
      { id: "image_2", url: "https://cdn.example/b.webp", position: 2 },
      { id: "image_3", url: "https://cdn.example/c.webp", position: 3 },
    ])
  })

  it("changes the idempotency hash when source order changes", async () => {
    const keys: string[] = []
    const capture = vi.fn(async (key: string) => {
      keys.push(key)
      return null
    })
    const baseImages = [
      { id: "image_1", url: "https://cdn.example/a.webp" },
      { id: "image_2", url: "https://cdn.example/b.webp" },
    ]
    await startVideoGeneration(input, "user_1", {
      provider: fluxProvider(),
      repository: repository({
        getSelectedImages: vi.fn().mockResolvedValue(baseImages),
        findByIdempotencyKey: capture,
        createProcessingVideo: vi.fn().mockResolvedValue({ id: "video_1" }),
      }),
    })
    await startVideoGeneration(input, "user_1", {
      provider: fluxProvider(),
      repository: repository({
        getSelectedImages: vi.fn().mockResolvedValue([baseImages[1], baseImages[0]]),
        findByIdempotencyKey: capture,
        createProcessingVideo: vi.fn().mockResolvedValue({ id: "video_2" }),
      }),
    })
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toEqual(keys[1])
  })

  it("is idempotent when the same ordered selection is resubmitted", async () => {
    const existing = { id: "video_existing", projectId: "project_1", status: "PROCESSING" }
    const create = vi.fn()
    const result = await startVideoGeneration(input, "user_1", {
      provider: runwayProvider({ create }),
      repository: repository({
        getSelectedImages: vi.fn().mockResolvedValue([{ id: "image_1", url: "https://cdn.example/source.webp" }]),
        findByIdempotencyKey: vi.fn().mockResolvedValue(existing),
        createProcessingVideo: vi.fn(),
      }),
    })
    // The idempotent path is serialized through the DTO too, so it echoes the
    // existing video's public fields without leaking any private metadata.
    expect(result).toMatchObject({ id: "video_existing", status: "PROCESSING" })
    expect(create).not.toHaveBeenCalled()
  })

  it("writes all source rows at positions 1..n and pins the provider", async () => {
    const createProcessingVideo = vi.fn().mockResolvedValue({ id: "video_1" })
    await startVideoGeneration(input, "user_1", {
      provider: fluxProvider({ create: vi.fn().mockResolvedValue({ taskId: "task_flux", taskMetadata: { pollingUrl: "https://poll.example/x" } }) }),
      repository: repository({
        getSelectedImages: vi.fn().mockResolvedValue([
          { id: "image_1", url: "https://cdn.example/a.webp" },
          { id: "image_2", url: "https://cdn.example/b.webp" },
        ]),
        createProcessingVideo,
      }),
    })
    expect(createProcessingVideo).toHaveBeenCalledTimes(1)
    const persisted = createProcessingVideo.mock.calls[0][0]
    expect(persisted.provider).toBe("bfl")
    expect(persisted.model).toBe("flux-3-video")
    expect(persisted.sourceImageId).toBe("image_1")
    expect(persisted.providerTaskId).toBe("task_flux")
    expect(persisted.providerTaskMetadata).toEqual({ pollingUrl: "https://poll.example/x" })
    expect(persisted.sources).toEqual([
      { imageId: "image_1", position: 1 },
      { imageId: "image_2", position: 2 },
    ])
  })

  it("refreshes through the provider recorded on the video with stored metadata", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "QUEUED", progress: 10 })
    const createForRecord = vi.fn().mockResolvedValue({ name: "bfl", model: "flux-3-video", create: vi.fn(), getStatus })
    const activeProvider = { name: "runway" as const, model: "gen4.5", create: vi.fn(), getStatus: vi.fn() }
    await refreshVideoStatus("video_1", "user_1", {
      provider: activeProvider,
      createProviderForRecord: createForRecord,
      storage: { put: vi.fn(), copyRemote: vi.fn() },
      repository: repository({
        getOwnedVideo: vi.fn().mockResolvedValue({
          id: "video_1",
          projectId: "project_1",
          providerTaskId: "task_flux",
          status: "PROCESSING",
          provider: "bfl",
          model: "flux-3-video",
          providerTaskMetadata: { pollingUrl: "https://poll.example/x" },
        }),
        updateStatus: vi.fn().mockResolvedValue({ id: "video_1", status: "PROCESSING" }),
      }),
    })
    expect(createForRecord).toHaveBeenCalledWith("bfl", "flux-3-video")
    expect(activeProvider.getStatus).not.toHaveBeenCalled()
    expect(getStatus).toHaveBeenCalledWith("task_flux", { pollingUrl: "https://poll.example/x" })
  })

  it("fails a video whose status link the provider now refuses, instead of polling it forever", async () => {
    const updateStatus = vi.fn(async (_id: string, status: string, code?: string) => ({ id: "video_1", status, safeErrorCode: code }))
    const lost = Object.assign(new Error("PROVIDER_REJECTED"), { code: "PROVIDER_REJECTED", status: 404 })
    const result = await refreshVideoStatus("video_1", "user_1", {
      provider: { name: "bfl", model: "flux-3-video", create: vi.fn(), getStatus: vi.fn() },
      createProviderForRecord: vi.fn().mockResolvedValue({ name: "bfl", model: "flux-3-video", create: vi.fn(), getStatus: vi.fn().mockRejectedValue(lost) }),
      storage: { put: vi.fn() },
      repository: repository({
        getOwnedVideo: vi.fn().mockResolvedValue({ id: "video_1", projectId: "project_1", providerTaskId: "task_1", status: "PROCESSING", provider: "bfl", model: "flux-3-video", providerTaskMetadata: { pollingUrl: "https://poll.example/x" } }),
        updateStatus,
      }),
    })
    expect(updateStatus).toHaveBeenCalledWith("video_1", "FAILED", "PROVIDER_TASK_LOST")
    expect((result as { status: string }).status).toBe("FAILED")
  })

  it("keeps polling through a temporary provider outage", async () => {
    const outage = Object.assign(new Error("PROVIDER_UNAVAILABLE"), { code: "PROVIDER_UNAVAILABLE", status: 503 })
    await expect(
      refreshVideoStatus("video_1", "user_1", {
        provider: { name: "bfl", model: "flux-3-video", create: vi.fn(), getStatus: vi.fn() },
        createProviderForRecord: vi.fn().mockResolvedValue({ name: "bfl", model: "flux-3-video", create: vi.fn(), getStatus: vi.fn().mockRejectedValue(outage) }),
        storage: { put: vi.fn() },
        repository: repository({
          getOwnedVideo: vi.fn().mockResolvedValue({ id: "video_1", projectId: "project_1", providerTaskId: "task_1", status: "PROCESSING", provider: "bfl", model: "flux-3-video", providerTaskMetadata: { pollingUrl: "https://poll.example/x" } }),
        }),
      }),
    ).rejects.toThrow("PROVIDER_UNAVAILABLE")
  })

  it("stores provider output before marking a video completed", async () => {
    const calls: string[] = []
    const copyRemote = vi.fn(async () => {
      calls.push("stored")
      return { url: "https://media.example/video.mp4", etag: "etag" }
    })
    const completeVideo = vi.fn(async () => {
      calls.push("completed")
      return { id: "video_1", status: "COMPLETED" }
    })
    const getStatus = vi.fn().mockResolvedValue({ state: "SUCCEEDED", outputUrl: "https://runway.example/temp.mp4" })
    const result = await refreshVideoStatus("video_1", "user_1", {
      provider: { name: "runway", model: "gen4.5", create: vi.fn(), getStatus: vi.fn() },
      createProviderForRecord: vi.fn().mockResolvedValue({ name: "runway", model: "gen4.5", create: vi.fn(), getStatus }),
      storage: { put: vi.fn(), copyRemote },
      repository: repository({
        getOwnedVideo: vi.fn().mockResolvedValue({
          id: "video_1",
          projectId: "project_1",
          providerTaskId: "task_1",
          status: "PROCESSING",
          provider: "runway",
          model: "gen4.5",
          providerTaskMetadata: null,
        }),
        completeVideo,
      }),
    })
    expect(copyRemote).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: "https://runway.example/temp.mp4" }))
    expect((result as { status: string }).status).toBe("COMPLETED")
    expect(calls).toEqual(["stored", "completed"])
  })

  it("never leaks private provider metadata in the create response", async () => {
    const created = await startVideoGeneration(input, "user_1", {
      provider: fluxProvider(),
      repository: repository({
        getSelectedImages: vi.fn().mockResolvedValue([{ id: "image_1", url: "https://cdn.example/a.webp" }]),
        createProcessingVideo: vi.fn().mockResolvedValue({
          id: "video_1",
          projectId: "project_1",
          status: "PROCESSING",
          provider: "bfl",
          model: "flux-3-video",
          url: null,
          durationSeconds: 5,
          aspectRatio: "16:9",
          safeErrorCode: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          completedAt: null,
          providerTaskId: "task_flux",
          providerTaskMetadata: { pollingUrl: "https://poll.example/x" },
          idempotencyKey: "idem_abc",
          technicalLogRef: "log_ref_1",
          storageKey: "projects/p/videos/v.mp4",
        }),
      }),
    })
    const serialized = JSON.stringify(created)
    expect(serialized).not.toContain("providerTaskMetadata")
    expect(serialized).not.toContain("pollingUrl")
    expect(serialized).not.toContain("providerTaskId")
    expect(serialized).not.toContain("idempotencyKey")
    expect(serialized).not.toContain("technicalLogRef")
    expect(serialized).not.toContain("storageKey")
  })

  it("never leaks private provider metadata in the refresh response", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "QUEUED", progress: 10 })
    const refreshed = await refreshVideoStatus("video_1", "user_1", {
      createProviderForRecord: vi.fn().mockResolvedValue({ name: "bfl", model: "flux-3-video", create: vi.fn(), getStatus }),
      storage: { put: vi.fn(), copyRemote: vi.fn() },
      repository: repository({
        getOwnedVideo: vi.fn().mockResolvedValue({
          id: "video_1",
          projectId: "project_1",
          providerTaskId: "task_flux",
          status: "PROCESSING",
          provider: "bfl",
          model: "flux-3-video",
          providerTaskMetadata: { pollingUrl: "https://poll.example/x" },
        }),
        updateStatus: vi.fn().mockResolvedValue({
          id: "video_1",
          projectId: "project_1",
          status: "PROCESSING",
          provider: "bfl",
          model: "flux-3-video",
          url: null,
          durationSeconds: 5,
          aspectRatio: "16:9",
          safeErrorCode: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          completedAt: null,
          providerTaskId: "task_flux",
          providerTaskMetadata: { pollingUrl: "https://poll.example/x" },
          idempotencyKey: "idem_abc",
          technicalLogRef: "log_ref_1",
        }),
      }),
    })
    const serialized = JSON.stringify(refreshed)
    expect(serialized).not.toContain("providerTaskMetadata")
    expect(serialized).not.toContain("pollingUrl")
    expect(serialized).not.toContain("providerTaskId")
    expect(serialized).not.toContain("idempotencyKey")
    expect(serialized).not.toContain("technicalLogRef")
    expect((refreshed as { progress?: number }).progress).toBe(10)
  })

  it("toVideoDto exposes only whitelisted fields", () => {
    // A full persisted row includes private fields; the DTO must strip them at
    // runtime. Passed as a record so the excess private keys are present.
    const fullRow: Record<string, unknown> = {
      id: "video_1",
      projectId: "project_1",
      status: "PROCESSING",
      provider: "bfl",
      model: "flux-3-video",
      url: null,
      durationSeconds: 5,
      aspectRatio: "16:9",
      safeErrorCode: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      completedAt: null,
      providerTaskId: "task_flux",
      providerTaskMetadata: { pollingUrl: "https://poll.example/x" },
      idempotencyKey: "idem_abc",
      technicalLogRef: "log_ref_1",
      storageKey: "projects/p/videos/v.mp4",
    }
    const dto = toVideoDto(fullRow)
    expect(Object.keys(dto).sort()).toEqual(
      [
        "aspectRatio",
        "completedAt",
        "createdAt",
        "draft",
        "durationSeconds",
        "id",
        "model",
        "resolution",
        "progress",
        "projectId",
        "provider",
        "safeErrorCode",
        "status",
        "updatedAt",
        "url",
      ].sort(),
    )
    // Render facts are read from the metadata; the private polling URL beside them is not.
    expect(dto).toMatchObject({ draft: false, resolution: null })
    expect(JSON.stringify(dto)).not.toContain("poll.example")
  })

  it("rejects an aspect ratio the resolved provider does not support", async () => {
    await expect(
      startVideoGeneration({ ...input, aspectRatio: "4:3" }, "user_1", {
        provider: runwayProvider(),
        repository: repository({
          getSelectedImages: vi.fn().mockResolvedValue([{ id: "image_1", url: "https://cdn.example/a.webp" }]),
        }),
      }),
    ).rejects.toBeInstanceOf(VideoWorkflowError)
  })
})
