// @vitest-environment node
//
// The suite runs under jsdom by default, which makes the OpenAI SDK refuse to
// construct a client: it detects `window` and assumes a browser is about to leak
// an API key. This module only ever runs on the server, so it is tested there.

import { afterEach, describe, expect, it, vi } from "vitest"

import { describeDecisionBackend, resolveDecisionProvider, type DecisionSettingsRepository } from "./runtime"

vi.mock("@/lib/providers/configuration", () => ({
  resolveOpenAITextSettings: vi.fn(async (environment: Record<string, string | undefined>) => {
    if (!environment.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required")
    return { provider: "OPENAI", apiKey: environment.OPENAI_API_KEY, model: "gpt-5-mini", source: "environment" }
  }),
}))

/**
 * Resolution order is the whole of the pluggability promise, so it is pinned
 * rather than left to be discovered on the host where it matters.
 */

function repository(options?: { typesafe?: { apiKey: string; model: string | null; endpoint: string | null } }) {
  const stored = options?.typesafe ?? null
  return {
    findTypeSafeConfiguration: vi.fn(async () => stored),
    hasTypeSafeConfiguration: vi.fn(async () => stored !== null),
  } satisfies DecisionSettingsRepository
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("resolveDecisionProvider", () => {
  it("defaults to OpenAI so the product works with no decision key configured", async () => {
    const resolved = await resolveDecisionProvider({ OPENAI_API_KEY: "sk-test" }, repository())
    expect(resolved.provider.name).toBe("openai")
    expect(resolved.source).toBe("environment")
  })

  it("prefers an administrator's stored TypeSafe credential over the environment", async () => {
    const store = repository({ typesafe: { apiKey: "stored-key", model: "jev-1.13.0", endpoint: null } })
    const resolved = await resolveDecisionProvider(
      { OPENAI_API_KEY: "sk-test", TYPESAFE_API_KEY: "env-key" },
      store,
    )
    expect(resolved.provider.name).toBe("typesafe")
    expect(resolved.source).toBe("database")
    expect(store.findTypeSafeConfiguration).toHaveBeenCalledOnce()
  })

  it("accepts a TypeSafe key from the environment before the admin console is used", async () => {
    const resolved = await resolveDecisionProvider({ OPENAI_API_KEY: "sk-test", TYPESAFE_API_KEY: "env-key" }, repository())
    expect(resolved.provider.name).toBe("typesafe")
    expect(resolved.source).toBe("environment")
  })

  it("also accepts JEV_API_KEY, which is what the provider's own docs call it", async () => {
    const resolved = await resolveDecisionProvider({ OPENAI_API_KEY: "sk-test", JEV_API_KEY: "env-key" }, repository())
    expect(resolved.provider.name).toBe("typesafe")
  })

  it("lets an operator pin OpenAI even with a TypeSafe credential stored", async () => {
    // The override exists so a suspect backend can be taken out of the path
    // without touching the database.
    const store = repository({ typesafe: { apiKey: "stored-key", model: null, endpoint: null } })
    const resolved = await resolveDecisionProvider(
      { OPENAI_API_KEY: "sk-test", DECISION_PROVIDER: "openai" },
      store,
    )
    expect(resolved.provider.name).toBe("openai")
    expect(store.findTypeSafeConfiguration).not.toHaveBeenCalled()
  })

  it("fails loudly when TypeSafe is pinned but no credential exists anywhere", async () => {
    // Quietly answering with OpenAI would hide a misconfiguration behind
    // plausible-looking results.
    await expect(
      resolveDecisionProvider({ OPENAI_API_KEY: "sk-test", DECISION_PROVIDER: "typesafe" }, repository()),
    ).rejects.toMatchObject({ code: "DECISION_PROVIDER_NOT_CONFIGURED" })
  })

  it("treats `jev` as an alias for the TypeSafe backend", async () => {
    const store = repository({ typesafe: { apiKey: "stored-key", model: null, endpoint: null } })
    const resolved = await resolveDecisionProvider({ DECISION_PROVIDER: "jev" }, store)
    expect(resolved.provider.name).toBe("typesafe")
  })

  it("surfaces a missing OpenAI key rather than returning a provider that cannot answer", async () => {
    await expect(resolveDecisionProvider({}, repository())).rejects.toThrow("OPENAI_API_KEY is required")
  })
})

describe("describeDecisionBackend", () => {
  it("reports the active backend without constructing it or reading a credential", async () => {
    const store = repository({ typesafe: { apiKey: "stored-key", model: null, endpoint: null } })
    await expect(describeDecisionBackend({ OPENAI_API_KEY: "sk-test" }, store)).resolves.toEqual({
      provider: "typesafe",
      source: "database",
      configured: true,
    })
    // The admin console must never receive key material, so the decrypting read
    // is not the one this path uses.
    expect(store.findTypeSafeConfiguration).not.toHaveBeenCalled()
  })

  it("reports an unconfigured pin instead of pretending it will work", async () => {
    await expect(describeDecisionBackend({ DECISION_PROVIDER: "typesafe" }, repository())).resolves.toEqual({
      provider: "typesafe",
      source: "none",
      configured: false,
    })
  })

  it("reports OpenAI as unconfigured when its key is absent", async () => {
    await expect(describeDecisionBackend({}, repository())).resolves.toEqual({
      provider: "openai",
      source: "environment",
      configured: false,
    })
  })
})
