import { describe, expect, it, vi, beforeEach } from "vitest"
import { z } from "zod"

import { PUT as putGenerationPolicy } from "./route"

const requireSuperAdmin = vi.fn()
const saveGenerationPolicy = vi.fn()
const getGenerationPolicy = vi.fn()

vi.mock("@/lib/auth/guards", () => ({
  requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args),
}))

vi.mock("@/features/admin/settings/service", () => ({
  saveGenerationPolicy: (...args: unknown[]) => saveGenerationPolicy(...args),
  getGenerationPolicy: (...args: unknown[]) => getGenerationPolicy(...args),
}))

const admin = { id: "admin_1", role: "SUPER_ADMIN" as const }

function request(body: unknown) {
  return new Request("http://app/api/admin/settings/generation", {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

describe("PUT /api/admin/settings/generation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSuperAdmin.mockResolvedValue(admin)
  })

  it("returns 200 and the saved policy for a valid count", async () => {
    saveGenerationPolicy.mockResolvedValue({ defaultImageCount: 3 })

    const response = await putGenerationPolicy(request({ defaultImageCount: 3 }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ defaultImageCount: 3 })
    expect(saveGenerationPolicy).toHaveBeenCalledWith({ defaultImageCount: 3 }, admin)
  })

  it("returns 400 with a safe message when the count is invalid", async () => {
    // The service validates via Zod and throws a ZodError the route maps to 400.
    saveGenerationPolicy.mockImplementation(() => {
      throw new z.ZodError([])
    })

    const response = await putGenerationPolicy(request({ defaultImageCount: 11 }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Default images must be a whole number from 1 to 10.",
    })
  })
})
