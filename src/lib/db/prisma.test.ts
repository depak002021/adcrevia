import { afterEach, describe, expect, it, vi } from "vitest"

describe("getPrisma", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()
  })

  it("reuses one client (one connection pool) per process in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/adcrevia")
    const { getPrisma } = await import("./prisma")

    // A new client per call means a new pool per call: this is what exhausted connections.
    expect(getPrisma()).toBe(getPrisma())
  })

  it("fails clearly when the database is not configured", async () => {
    vi.stubEnv("DATABASE_URL", "")
    const { getPrisma } = await import("./prisma")

    expect(() => getPrisma()).toThrow("DATABASE_URL is required")
  })
})
