import { describe, expect, it, vi, beforeEach } from "vitest"
import { z } from "zod"

import { POST as postDirections } from "./route"
import { HttpError } from "@/lib/http/http-error"

const requireUser = vi.fn()
const createDirections = vi.fn()

vi.mock("@/lib/auth/guards", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}))

vi.mock("@/features/directions/service", () => ({
  createDirections: (...args: unknown[]) => createDirections(...args),
}))

const user = { id: "user_1", role: "USER" as const, active: true }
const projectId = "cjld2cjxh0000qzrmn831i7rn"

function request(body: unknown = { projectId }) {
  return new Request("http://app/api/ai/creative-directions", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

describe("POST /api/ai/creative-directions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue(user)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("returns 200 with the generated directions", async () => {
    createDirections.mockResolvedValue([{ position: 1, title: "A" }, { position: 2, title: "B" }])
    const response = await postDirections(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ directions: [{ position: 1, title: "A" }, { position: 2, title: "B" }] })
    expect(createDirections).toHaveBeenCalledWith(projectId, user.id)
  })

  it("returns 400 for an invalid project id", async () => {
    const response = await postDirections(request({ projectId: "not-a-cuid" }))
    expect(response.status).toBe(400)
    expect(createDirections).not.toHaveBeenCalled()
  })

  it("preserves the HttpError status for ownership/not-found", async () => {
    createDirections.mockRejectedValue(new HttpError(404, "Project not found"))
    const response = await postDirections(request())
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Project not found" })
  })

  it("returns 503 with admin guidance when OpenAI is not configured", async () => {
    createDirections.mockRejectedValue(new Error("OPENAI_API_KEY is required"))
    const response = await postDirections(request())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: "Connect OpenAI in the admin console to generate live directions." })
  })

  it("returns 502 with a retry message for unusable model output", async () => {
    createDirections.mockRejectedValue(new Error("DIRECTIONS_MUST_BE_DISTINCT"))
    const response = await postDirections(request())
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: "The model returned an unusable response. Please try again." })
  })

  it("returns 502 with credential guidance when OpenAI rejects the key", async () => {
    createDirections.mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }))
    const response = await postDirections(request())
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: "The OpenAI credential was rejected. Check the key in the admin console." })
  })

  it("returns 502 with a rate-limit message", async () => {
    createDirections.mockRejectedValue(Object.assign(new Error("Too Many Requests"), { status: 429 }))
    const response = await postDirections(request())
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: "OpenAI is rate limiting requests. Please wait and try again." })
  })

  it("falls back to a generic 502 for unknown errors", async () => {
    createDirections.mockRejectedValue(new Error("boom"))
    const response = await postDirections(request())
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: "Creative directions are temporarily unavailable." })
  })

  it("treats a Zod validation error as unusable model output", async () => {
    createDirections.mockRejectedValue(new z.ZodError([]))
    const response = await postDirections(request())
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: "The model returned an unusable response. Please try again." })
  })
})
