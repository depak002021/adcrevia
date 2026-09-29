import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getPrisma } from "@/lib/db/prisma"
import { decryptCredential } from "@/lib/encryption/provider-credentials"
import {
  listMaskedProviders,
  saveBflConfigurations,
  saveProviderConfiguration,
  testBflCredential,
} from "./service"

vi.mock("@/lib/db/prisma", () => ({ getPrisma: vi.fn() }))

const originalKey = process.env.ENCRYPTION_KEY
const mockedGetPrisma = vi.mocked(getPrisma)

type FakeProvider = { id: string; slug: string; name: string; kind: "IMAGE" | "VIDEO"; enabled: boolean }
type FakeConfiguration = {
  id: string
  providerId: string
  name: string
  model: string | null
  endpoint: string | null
  encryptedCredential: unknown
  enabled: boolean
  lastTestedAt: Date | null
  lastTestSucceeded: boolean | null
  safeTestMessage: string | null
}

function createPrismaHarness() {
  const providers = new Map<string, FakeProvider>()
  const configurations: FakeConfiguration[] = []
  const operations: string[] = []
  let nextConfiguration = 1

  const transaction = {
    // The advisory lock is acquired via $executeRaw (pg_advisory_xact_lock
    // returns void, so $executeRaw's row count avoids a deserialization error).
    $executeRaw: vi.fn(async (_query: TemplateStringsArray, lockKey: number) => {
      operations.push(`lock:${lockKey}`)
      return 0
    }),
    aIProvider: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        operations.push(`upsert:${where.slug}`)
        const existing = providers.get(where.slug)
        if (existing) {
          Object.assign(existing, update)
          return existing
        }
        const provider = { id: `provider_${where.slug}`, enabled: true, ...create } as FakeProvider
        providers.set(where.slug, provider)
        return provider
      }),
    },
    aPIConfiguration: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        operations.push(where.providerId ? `deactivate-provider:${where.providerId}` : `deactivate-kind:${where.provider.kind}`)
        let count = 0
        for (const configuration of configurations) {
          const provider = [...providers.values()].find(({ id }) => id === configuration.providerId)
          const matchesProvider = where.providerId ? configuration.providerId === where.providerId : provider?.kind === where.provider.kind
          if (matchesProvider && (!where.enabled || configuration.enabled)) {
            Object.assign(configuration, data)
            count += 1
          }
        }
        return { count }
      }),
      create: vi.fn(async ({ data }: any) => {
        const configuration: FakeConfiguration = {
          id: `config_${nextConfiguration++}`,
          ...data,
          lastTestedAt: null,
          lastTestSucceeded: null,
          safeTestMessage: null,
        }
        operations.push(`create:${configuration.providerId}:${configuration.enabled}`)
        configurations.push(configuration)
        return configuration
      }),
    },
  }
  const db = { $transaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)) }

  return {
    db,
    operations,
    enabledFor(slug: string) {
      const provider = providers.get(slug)
      return configurations.filter((configuration) => configuration.providerId === provider?.id && configuration.enabled)
    },
  }
}

describe("provider configuration", () => {
  beforeEach(() => { process.env.ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64") })
  afterEach(() => {
    mockedGetPrisma.mockReset()
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = originalKey
  })

  it("returns a fixed mask and never ciphertext or plaintext", async () => {
    const saved: any[] = []
    const repository = {
      save: vi.fn(async (input) => { const row = { id: "config_1", ...input, lastTestedAt: null, lastTestSucceeded: null, safeTestMessage: null }; saved.push(row); return row }),
      list: vi.fn(async () => saved),
    }
    const apiKey = "sk-a-very-secret-provider-key"
    await saveProviderConfiguration({ kind: "IMAGE", provider: "OPENAI", model: "gpt-image-1.5", apiKey, enabled: true }, { id: "admin_1", role: "SUPER_ADMIN" }, repository)
    const [result] = await listMaskedProviders("IMAGE", repository)
    expect(result.apiKey).toBe("••••••••••••")
    expect(JSON.stringify(result)).not.toContain(apiKey)
    expect(JSON.stringify(result)).not.toContain("ciphertext")
  })

  it("rejects a non-admin caller", async () => {
    await expect(saveProviderConfiguration({ kind: "VIDEO", provider: "RUNWAY", model: "gen4.5", apiKey: "runway-provider-key-123", enabled: true }, { id: "user_1", role: "USER" }, { save: vi.fn(), list: vi.fn() })).rejects.toMatchObject({ status: 403 })
  })

  it.each([
    ["VIDEO", "OPENAI"],
    ["IMAGE", "RUNWAY"],
  ])("rejects the invalid %s/%s provider identity", async (kind, provider) => {
    const save = vi.fn()

    await expect(saveProviderConfiguration(
      { kind, provider, model: "provider-model", apiKey: "provider-key-with-safe-length", enabled: true },
      { id: "admin_1", role: "SUPER_ADMIN" },
      { save, list: vi.fn() },
    )).rejects.toMatchObject({ issues: expect.any(Array) })
    expect(save).not.toHaveBeenCalled()
  })

  it("saves independently enabled BFL image and video configurations with separate encrypted credentials", async () => {
    const apiKey = "bfl-a-very-secret-provider-key"
    const saveBfl = vi.fn(async (rows: any[]) => rows.map((row, index) => ({
      id: `config_${index + 1}`,
      ...row,
      lastTestedAt: null,
      lastTestSucceeded: null,
      safeTestMessage: null,
    })))

    const result = await saveBflConfigurations({ apiKey, imageEnabled: true, videoEnabled: false }, { id: "admin_1", role: "SUPER_ADMIN" }, { saveBfl })
    const [image, video] = saveBfl.mock.calls[0][0]

    expect(image).toMatchObject({ kind: "IMAGE", provider: "BFL", slug: "bfl-image", model: "flux-2-pro", enabled: true })
    expect(video).toMatchObject({ kind: "VIDEO", provider: "BFL", slug: "bfl-video", model: "flux-3-video", enabled: false })
    expect(image.encryptedCredential).not.toEqual(video.encryptedCredential)
    expect(decryptCredential(image.encryptedCredential)).toBe(apiKey)
    expect(decryptCredential(video.encryptedCredential)).toBe(apiKey)
    expect(result.map((row) => row.apiKey)).toEqual(["••••••••••••", "••••••••••••"])
    expect(JSON.stringify(result)).not.toContain(apiKey)
    expect(JSON.stringify(result)).not.toContain("ciphertext")
  })

  it("deactivates the previous BFL configuration when an enabled kind is later unchecked", async () => {
    const harness = createPrismaHarness()
    mockedGetPrisma.mockReturnValue(harness.db as never)
    const admin = { id: "admin_1", role: "SUPER_ADMIN" as const }

    await saveBflConfigurations({ apiKey: "bfl-first-provider-key", imageEnabled: false, videoEnabled: true }, admin)
    expect(harness.enabledFor("bfl-video")).toHaveLength(1)

    await saveBflConfigurations({ apiKey: "bfl-second-provider-key", imageEnabled: false, videoEnabled: false }, admin)
    expect(harness.enabledFor("bfl-video")).toHaveLength(0)
  })

  it("uses the same per-kind activation serialization for ordinary and BFL saves", async () => {
    const harness = createPrismaHarness()
    mockedGetPrisma.mockReturnValue(harness.db as never)
    const admin = { id: "admin_1", role: "SUPER_ADMIN" as const }

    await saveProviderConfiguration({ kind: "IMAGE", provider: "OPENAI", model: "gpt-image-1.5", apiKey: "openai-provider-key", enabled: true }, admin)
    const ordinaryImageLock = harness.operations[0]
    expect(ordinaryImageLock).toMatch(/^lock:\d+$/)
    expect(harness.operations[1]).toBe("upsert:openai-image")

    harness.operations.length = 0
    await saveBflConfigurations({ apiKey: "bfl-provider-key-123", imageEnabled: true, videoEnabled: true }, admin)
    const bflLocks = harness.operations.filter((operation) => operation.startsWith("lock:"))
    expect(bflLocks).toHaveLength(2)
    expect(bflLocks[0]).toBe(ordinaryImageLock)
    expect(harness.operations.slice(0, 2)).toEqual(bflLocks)

    harness.operations.length = 0
    await saveProviderConfiguration({ kind: "VIDEO", provider: "RUNWAY", model: "gen4.5", apiKey: "runway-provider-key", enabled: true }, admin)
    expect(harness.operations[0]).toBe(bflLocks[1])
    expect(harness.operations[1]).toBe("upsert:runway-video")
  })

  it("tests BFL credits using only the x-key header and never returns the balance", async () => {
    const apiKey = "bfl-a-very-secret-provider-key"
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ credits: 987.65 }), { status: 200 }))

    const result = await testBflCredential({ apiKey }, { id: "admin_1", role: "SUPER_ADMIN" }, fetcher)

    expect(fetcher).toHaveBeenCalledWith("https://api.bfl.ai/v1/credits", {
      method: "GET",
      headers: { "x-key": apiKey },
    })
    expect(result).toMatchObject({ ok: true, category: "CONNECTED" })
    expect(Object.keys(result).sort()).toEqual(["category", "ok", "testedAt"])
    expect(JSON.stringify(result)).not.toContain("987.65")
  })

  it.each([
    [401, "AUTHENTICATION_FAILED"],
    [403, "AUTHENTICATION_FAILED"],
    [429, "RATE_LIMITED"],
    [500, "PROVIDER_UNAVAILABLE"],
    [503, "PROVIDER_UNAVAILABLE"],
  ])("maps BFL status %i to the safe %s category", async (status, category) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("provider detail that must stay private", { status }))

    await expect(testBflCredential(
      { apiKey: "bfl-a-very-secret-provider-key" },
      { id: "admin_1", role: "SUPER_ADMIN" },
      fetcher,
    )).resolves.toMatchObject({ ok: false, category })
  })

  it("treats a non-numeric BFL balance as unavailable", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ credits: "unknown" }), { status: 200 }))

    await expect(testBflCredential(
      { apiKey: "bfl-a-very-secret-provider-key" },
      { id: "admin_1", role: "SUPER_ADMIN" },
      fetcher,
    )).resolves.toMatchObject({ ok: false, category: "PROVIDER_UNAVAILABLE" })
  })
})
