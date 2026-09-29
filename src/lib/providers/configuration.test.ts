import { describe, expect, it, vi } from "vitest"

import {
  listAvailableImageProviders,
  listSelectableImageModels,
  resolveActiveProvider,
  resolveImageProviderByName,
  resolveOpenAITextSettings,
  type ProviderSettingsRepository,
} from "./configuration"

const encrypted = { version: 1 as const, iv: "iv", tag: "tag", ciphertext: "ciphertext" }

function repository(overrides: Partial<ProviderSettingsRepository> = {}): ProviderSettingsRepository {
  return {
    findActive: vi.fn().mockResolvedValue(null),
    findOpenAIImageCandidates: vi.fn().mockResolvedValue([]),
    findEnabledByKind: vi.fn().mockResolvedValue([]),
    findEnabledBySlugs: vi.fn().mockResolvedValue(null),
    findConfiguredByKind: vi.fn().mockResolvedValue([]),
    findConfiguredBySlugs: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

describe("resolveActiveProvider", () => {
  it("resolves the active BFL image configuration", async () => {
    const settings = repository({
      findActive: vi.fn().mockResolvedValue({ slug: "bfl-image", model: "flux-2-pro", endpoint: "https://api.bfl.ai/v1", encryptedCredential: encrypted }),
    })

    await expect(resolveActiveProvider("IMAGE", {}, settings, () => "saved-bfl-key")).resolves.toEqual({
      provider: "BFL",
      apiKey: "saved-bfl-key",
      model: "flux-2-pro",
      endpoint: "https://api.bfl.ai/v1",
      source: "database",
    })
  })

  it("resolves the active BFL video configuration", async () => {
    const settings = repository({
      findActive: vi.fn().mockResolvedValue({ slug: "bfl-video", model: "flux-3-video", endpoint: null, encryptedCredential: encrypted }),
    })

    await expect(resolveActiveProvider("VIDEO", {}, settings, () => "saved-bfl-key")).resolves.toEqual({
      provider: "BFL",
      apiKey: "saved-bfl-key",
      model: "flux-3-video",
      endpoint: undefined,
      source: "database",
    })
  })

  it.each([
    ["IMAGE" as const, "openai", "OPENAI" as const, "gpt-image-1.5"],
    ["VIDEO" as const, "runway", "RUNWAY" as const, "gen4.5"],
  ])("accepts the rolling-deployment alias %s/%s", async (kind, slug, provider, model) => {
    const settings = repository({
      findActive: vi.fn().mockResolvedValue({ slug, model, endpoint: null, encryptedCredential: encrypted }),
    })

    await expect(resolveActiveProvider(kind, {}, settings, () => "saved-key")).resolves.toMatchObject({ provider, model, source: "database" })
  })

  it("falls back to the kind's environment provider only when no active database row exists", async () => {
    await expect(resolveActiveProvider("VIDEO", {
      RUNWAYML_API_SECRET: "environment-key",
      RUNWAY_VIDEO_MODEL: "gen4.5",
    }, repository())).resolves.toEqual({
      provider: "RUNWAY",
      apiKey: "environment-key",
      model: "gen4.5",
      endpoint: undefined,
      source: "environment",
    })
  })

  it("throws instead of falling back when an active database credential is malformed", async () => {
    const settings = repository({
      findActive: vi.fn().mockResolvedValue({ slug: "openai-image", model: "gpt-image-1.5", endpoint: null, encryptedCredential: encrypted }),
    })
    const decrypt = vi.fn(() => { throw new Error("Stored provider credential is unreadable") })

    await expect(resolveActiveProvider("IMAGE", { OPENAI_API_KEY: "environment-key" }, settings, decrypt)).rejects.toThrow("Stored provider credential is unreadable")
  })

  it("throws the existing safe configuration error when neither source is configured", async () => {
    await expect(resolveActiveProvider("IMAGE", {}, repository())).rejects.toThrow("OPENAI_API_KEY is required")
  })
})

describe("resolveOpenAITextSettings", () => {
  it("uses the newest OpenAI image credential regardless of image activation and always selects the text model", async () => {
    const findActive = vi.fn().mockResolvedValue({ slug: "bfl-image", model: "flux-2-pro", endpoint: null, encryptedCredential: encrypted })
    const findOpenAIImageCandidates = vi.fn().mockResolvedValue([{ slug: "openai-image", model: "gpt-image-1.5", endpoint: null, encryptedCredential: encrypted }])
    const settings = repository({ findActive, findOpenAIImageCandidates })

    await expect(resolveOpenAITextSettings({
      OPENAI_API_KEY: "environment-key",
      OPENAI_TEXT_MODEL: "gpt-5.2",
    }, settings, () => "saved-openai-key")).resolves.toEqual({
      provider: "OPENAI",
      apiKey: "saved-openai-key",
      model: "gpt-5.2",
      endpoint: undefined,
      source: "database",
    })
    expect(findActive).not.toHaveBeenCalled()
    expect(findOpenAIImageCandidates).toHaveBeenCalledOnce()
  })

  it("uses the default text model rather than the stored image model", async () => {
    const settings = repository({
      findOpenAIImageCandidates: vi.fn().mockResolvedValue([{ slug: "openai", model: "gpt-image-1", endpoint: null, encryptedCredential: encrypted }]),
    })

    await expect(resolveOpenAITextSettings({}, settings, () => "saved-openai-key")).resolves.toMatchObject({
      provider: "OPENAI",
      model: "gpt-5-mini",
      apiKey: "saved-openai-key",
      source: "database",
    })
  })

  it("uses the newest decryptable OpenAI credential", async () => {
    const unreadable = { ...encrypted, ciphertext: "unreadable" }
    const settings = repository({
      findOpenAIImageCandidates: vi.fn().mockResolvedValue([
        { slug: "openai-image", model: "new-image-model", endpoint: null, encryptedCredential: unreadable },
        { slug: "openai", model: "old-image-model", endpoint: null, encryptedCredential: encrypted },
      ]),
    })
    const decrypt = vi.fn((credential: typeof encrypted) => {
      if (credential.ciphertext === "unreadable") throw new Error("Stored provider credential is unreadable")
      return "older-decryptable-key"
    })

    await expect(resolveOpenAITextSettings({ OPENAI_TEXT_MODEL: "gpt-5.2" }, settings, decrypt)).resolves.toMatchObject({
      apiKey: "older-decryptable-key",
      model: "gpt-5.2",
      source: "database",
    })
  })

  it("does not fall back to the environment when stored OpenAI credentials are all malformed", async () => {
    const settings = repository({
      findOpenAIImageCandidates: vi.fn().mockResolvedValue([{ slug: "openai-image", model: null, endpoint: null, encryptedCredential: encrypted }]),
    })
    const decrypt = vi.fn(() => { throw new Error("Stored provider credential is unreadable") })

    await expect(resolveOpenAITextSettings({ OPENAI_API_KEY: "environment-key" }, settings, decrypt)).rejects.toThrow("Stored provider credential is unreadable")
  })
})

describe("listAvailableImageProviders", () => {
  it("lists every configured image provider (FLUX first), marking the enabled one active", async () => {
    const repo = repository({
      findConfiguredByKind: vi.fn().mockResolvedValue([
        { slug: "openai-image", model: "gpt-image-1.5", endpoint: null, encryptedCredential: encrypted, enabled: true },
        { slug: "bfl-image", model: "flux-2-pro", endpoint: null, encryptedCredential: encrypted, enabled: false },
      ]),
    })
    const options = await listAvailableImageProviders({}, repo)
    // FLUX leads even though OpenAI is the enabled/active one.
    expect(options).toEqual([
      { provider: "bfl", model: "flux-2-pro", label: "FLUX (Black Forest Labs)", active: false },
      { provider: "openai", model: "gpt-image-1.5", label: "OpenAI", active: true },
    ])
  })

  it("includes a configured but disabled BFL provider so it can be selected", async () => {
    const repo = repository({
      findConfiguredByKind: vi.fn().mockResolvedValue([
        { slug: "bfl-image", model: "flux-2-pro", endpoint: null, encryptedCredential: encrypted, enabled: false },
      ]),
    })
    const options = await listAvailableImageProviders({}, repo)
    expect(options).toEqual([{ provider: "bfl", model: "flux-2-pro", label: "FLUX (Black Forest Labs)", active: false }])
  })

  it("returns an empty list when no image provider is configured", async () => {
    const repo = repository({ findConfiguredByKind: vi.fn().mockResolvedValue([]) })
    await expect(listAvailableImageProviders({}, repo)).resolves.toEqual([])
  })
})

describe("resolveImageProviderByName", () => {
  it("resolves the chosen BFL image provider even when it is disabled", async () => {
    const repo = repository({
      findConfiguredBySlugs: vi.fn().mockResolvedValue({ slug: "bfl-image", model: "flux-2-pro", endpoint: null, encryptedCredential: encrypted, enabled: false }),
    })
    await expect(resolveImageProviderByName("bfl", undefined, {}, repo, () => "saved-bfl-key")).resolves.toEqual({
      provider: "BFL",
      apiKey: "saved-bfl-key",
      model: "flux-2-pro",
      endpoint: undefined,
      source: "database",
    })
  })

  it("falls back to the BFL environment key when no database row exists", async () => {
    const repo = repository({ findConfiguredBySlugs: vi.fn().mockResolvedValue(null) })
    await expect(resolveImageProviderByName("bfl", undefined, { BFL_API_KEY: "env-bfl-key" }, repo)).resolves.toMatchObject({
      provider: "BFL",
      apiKey: "env-bfl-key",
      model: "flux-2-pro",
      source: "environment",
    })
  })

  it("throws a safe error when the chosen provider is not configured", async () => {
    const repo = repository({ findConfiguredBySlugs: vi.fn().mockResolvedValue(null) })
    await expect(resolveImageProviderByName("bfl", undefined, {}, repo)).rejects.toThrow("BFL_API_KEY is required")
  })
})

describe("listSelectableImageModels", () => {
  it("lists every catalog model, marking configured live providers selectable", async () => {
    const repo = repository({
      findConfiguredByKind: vi.fn().mockResolvedValue([
        { slug: "bfl-image", model: "flux-2-pro", endpoint: null, encryptedCredential: encrypted, enabled: true },
      ]),
    })
    const models = await listSelectableImageModels({}, repo)

    // FLUX models are configured (live + saved credential) and the active one is flagged.
    const flux2 = models.find((m) => m.provider === "bfl" && m.model === "flux-2-pro")
    expect(flux2).toMatchObject({ configured: true, active: true, status: "live" })
    const fluxFlex = models.find((m) => m.provider === "bfl" && m.model === "flux-2-flex")
    expect(fluxFlex).toMatchObject({ configured: true, active: false })

    // OpenAI is live but has no saved credential here -> listed but not configured.
    const openai = models.find((m) => m.provider === "openai")
    expect(openai).toMatchObject({ configured: false, status: "live" })

    // Google is now live but has no saved credential here -> listed, not configured.
    const google = models.find((m) => m.provider === "google")
    expect(google).toMatchObject({ configured: false, status: "live" })

    // Planned providers (e.g. Stability) are listed but never configured/selectable.
    const stability = models.find((m) => m.provider === "stability")
    expect(stability).toMatchObject({ configured: false, status: "planned" })
  })
})
