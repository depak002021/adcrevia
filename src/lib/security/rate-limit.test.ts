import { describe, expect, it } from "vitest"

import { RateLimiter, type RateLimitStore } from "./rate-limit"

class MemoryStore implements RateLimitStore {
  buckets = new Map<string, number>()

  async increment(input: { keyHash: string; action: string; windowStart: Date; expiresAt: Date }) {
    const key = `${input.action}:${input.keyHash}:${input.windowStart.toISOString()}`
    const count = (this.buckets.get(key) ?? 0) + 1
    this.buckets.set(key, count)
    return count
  }
}

describe("RateLimiter", () => {
  it("allows requests through the configured limit and blocks the next one", async () => {
    const now = new Date("2026-09-17T10:03:00.000Z")
    const limiter = new RateLimiter(new MemoryStore(), { now: () => now })

    expect(await limiter.check({ action: "password-reset", identifier: "203.0.113.1", limit: 2, windowSeconds: 600 })).toMatchObject({ allowed: true, remaining: 1 })
    expect(await limiter.check({ action: "password-reset", identifier: "203.0.113.1", limit: 2, windowSeconds: 600 })).toMatchObject({ allowed: true, remaining: 0 })
    expect(await limiter.check({ action: "password-reset", identifier: "203.0.113.1", limit: 2, windowSeconds: 600 })).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 420 })
  })

  it("hashes identifiers before handing them to persistent storage", async () => {
    const store = new MemoryStore()
    const limiter = new RateLimiter(store, { now: () => new Date("2026-09-17T10:00:00.000Z") })

    await limiter.check({ action: "register", identifier: "person@example.com", limit: 1, windowSeconds: 60 })

    const persistedKey = [...store.buckets.keys()][0]
    expect(persistedKey).not.toContain("person@example.com")
    expect(persistedKey).toMatch(/^register:[a-f0-9]{64}:/)
  })

  it("uses independent fixed windows", async () => {
    let now = new Date("2026-09-17T10:00:59.000Z")
    const limiter = new RateLimiter(new MemoryStore(), { now: () => now })
    const input = { action: "login", identifier: "client", limit: 1, windowSeconds: 60 }

    expect((await limiter.check(input)).allowed).toBe(true)
    expect((await limiter.check(input)).allowed).toBe(false)
    now = new Date("2026-09-17T10:01:00.000Z")
    expect((await limiter.check(input)).allowed).toBe(true)
  })
})
