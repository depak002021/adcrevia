import { describe, expect, it, vi, beforeEach } from "vitest"

import { POST as postVideo } from "./route"
import { VideoProviderError } from "@/lib/providers/videos/errors"
import { VideoWorkflowError } from "@/features/videos/service"

const requireUser = vi.fn()
const startVideoGeneration = vi.fn()
const rateLimiterCheck = vi.fn()

vi.mock("@/lib/auth/guards", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}))

vi.mock("@/features/videos/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/videos/service")>()
  return {
    ...actual,
    startVideoGeneration: (...args: unknown[]) => startVideoGeneration(...args),
  }
})

vi.mock("@/lib/security/rate-limit", () => ({
  rateLimiter: { check: (...args: unknown[]) => rateLimiterCheck(...args) },
  rateLimitResponse: (retryAfterSeconds: number) =>
    Response.json({ error: "Too many requests. Please wait and try again." }, { status: 429, headers: { "retry-after": String(retryAfterSeconds) } }),
}))

const user = { id: "user_1", role: "USER" as const, active: true }

const validBody = {
  projectId: "project_1",
  prompt: "Move through both product scenes with controlled cinematic cuts.",
  motionStyle: "CINEMATIC" as const,
  duration: 5,
  aspectRatio: "16:9" as const,
}

function request(body: unknown) {
  return new Request("http://app/api/videos/generate", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

describe("POST /api/videos/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue(user)
    rateLimiterCheck.mockResolvedValue({ allowed: true })
  })

  it("returns 201 with the serialized video for a valid project-scoped request", async () => {
    startVideoGeneration.mockResolvedValue({ id: "video_1", projectId: "project_1", status: "PROCESSING", progress: 0 })

    const response = await postVideo(request(validBody))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      video: { id: "video_1", projectId: "project_1", status: "PROCESSING", progress: 0 },
    })
    expect(startVideoGeneration).toHaveBeenCalledWith(validBody, user.id)
  })

  it("returns 422 with the safe code when a multi-source render targets Runway, without leaking a provider body", async () => {
    startVideoGeneration.mockRejectedValue(new VideoProviderError("MULTI_IMAGE_REQUIRES_FLUX"))

    const response = await postVideo(request(validBody))

    expect(response.status).toBe(422)
    const body = await response.json() as Record<string, unknown>
    expect(body).toEqual({ error: "This selection needs the multi-image video provider.", code: "MULTI_IMAGE_REQUIRES_FLUX" })
    // The response exposes only the safe code — never a raw provider body.
    expect(JSON.stringify(body)).not.toContain("pollingUrl")
  })

  it("returns 422 when no completed image is selected", async () => {
    startVideoGeneration.mockRejectedValue(new VideoWorkflowError("SELECTED_IMAGE_REQUIRED"))

    const response = await postVideo(request(validBody))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: "Select a completed image before creating a video.",
      code: "SELECTED_IMAGE_REQUIRED",
    })
  })
})
