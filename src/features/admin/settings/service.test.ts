import { describe, expect, it, vi } from "vitest"

import { getDefaultImageCount, getGenerationPolicy, saveGenerationPolicy, type GenerationPolicyRepository } from "./service"

const admin = { id: "admin_1", role: "SUPER_ADMIN" as const }
const user = { id: "user_1", role: "USER" as const }

function repository(readValue: unknown = null): GenerationPolicyRepository {
  return {
    read: vi.fn().mockResolvedValue(readValue),
    write: vi.fn().mockImplementation(async (_key: string, value: number) => value),
  }
}

describe("generation policy service", () => {
  it.each([1, 10])("accepts boundary count %s", async (count) => {
    const repository = { read: vi.fn().mockResolvedValue(null), write: vi.fn().mockResolvedValue(count) }

    await expect(saveGenerationPolicy({ defaultImageCount: count }, admin, repository)).resolves.toEqual({ defaultImageCount: count })
  })

  it.each([0, 11, 2.5])("rejects invalid count %s", async (count) => {
    await expect(saveGenerationPolicy({ defaultImageCount: count }, admin, repository())).rejects.toThrow()
  })

  it("falls back to four for missing or invalid storage", async () => {
    await expect(getDefaultImageCount(repository("broken"))).resolves.toBe(4)
    await expect(getDefaultImageCount(repository(null))).resolves.toBe(4)
  })

  it("returns the persisted policy", async () => {
    await expect(getGenerationPolicy(repository(7))).resolves.toEqual({ defaultImageCount: 7 })
  })

  it("requires a super-admin before writing", async () => {
    const store = repository()

    await expect(saveGenerationPolicy({ defaultImageCount: 5 }, user, store)).rejects.toMatchObject({ status: 403 })
    expect(store.write).not.toHaveBeenCalled()
  })

  it("writes the policy as a numeric JSON value", async () => {
    const store = repository()

    await saveGenerationPolicy({ defaultImageCount: 6 }, admin, store)

    expect(store.write).toHaveBeenCalledWith("generation.defaultImageCount", 6)
  })
})
