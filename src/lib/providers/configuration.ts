import { resolveTextModels } from "@/lib/ai/text-models"
import { getPrisma } from "@/lib/db/prisma"
import { decryptCredential, type EncryptedCredential } from "@/lib/encryption/provider-credentials"
import { catalogProviders, type CatalogKind, type CatalogStatus } from "./catalog"

export type ProviderKind = "IMAGE" | "VIDEO"
export type ProviderName = "OPENAI" | "RUNWAY" | "BFL" | "GOOGLE" | "SEEDANCE" | "KLING"
type Environment = Record<string, string | undefined>

type StoredSettings = {
  slug: string
  model: string | null
  endpoint: string | null
  encryptedCredential: EncryptedCredential
  enabled: boolean
}

export type ResolvedProviderSettings = {
  provider: ProviderName
  model: string
  apiKey: string
  endpoint?: string
  source: "database" | "environment"
}

export type ProviderSettingsRepository = {
  findActive(kind: ProviderKind): Promise<StoredSettings | null>
  findOpenAIImageCandidates(): Promise<StoredSettings[]>
  findEnabledByKind(kind: ProviderKind): Promise<StoredSettings[]>
  findEnabledBySlugs(slugs: string[]): Promise<StoredSettings | null>
  findConfiguredByKind(kind: ProviderKind): Promise<StoredSettings[]>
  findConfiguredBySlugs(slugs: string[]): Promise<StoredSettings | null>
  /** A yes/no system setting (absent or unreadable = no). Optional for test fakes. */
  readFlag?(key: string): Promise<boolean>
}

/** Admin switch: Seedance renders only once BytePlus has enabled the account. */
export const SEEDANCE_AVAILABLE_KEY = "video.seedanceAvailable"

export async function isSeedanceAvailable(): Promise<boolean> {
  try {
    const row = await getPrisma().systemSetting.findUnique({ where: { key: SEEDANCE_AVAILABLE_KEY } })
    return row?.value === true
  } catch {
    return false
  }
}

export async function resolveActiveProvider(
  kind: ProviderKind,
  environment: Environment = process.env,
  repository: ProviderSettingsRepository = prismaProviderSettingsRepository,
  decrypt: (value: EncryptedCredential) => string = decryptCredential,
): Promise<ResolvedProviderSettings> {
  const stored = await repository.findActive(kind)
  if (stored) {
    const provider = providerForSlug(kind, stored.slug)
    return {
      provider,
      apiKey: decrypt(stored.encryptedCredential),
      model: stored.model ?? defaultModel(kind, provider, environment),
      endpoint: stored.endpoint ?? undefined,
      source: "database",
    }
  }

  const provider = kind === "IMAGE" ? "OPENAI" : "RUNWAY"
  const apiKey = provider === "OPENAI" ? environment.OPENAI_API_KEY : environment.RUNWAYML_API_SECRET
  if (!apiKey) throw new Error(provider === "OPENAI" ? "OPENAI_API_KEY is required" : "RUNWAYML_API_SECRET is required")
  return {
    provider,
    apiKey,
    model: defaultModel(kind, provider, environment),
    endpoint: undefined,
    source: "environment",
  }
}

export type ImageProviderOption = {
  provider: "openai" | "bfl"
  model: string
  label: string
  active: boolean
}

const IMAGE_PROVIDER_LABELS: Record<"openai" | "bfl", string> = {
  bfl: "FLUX (Black Forest Labs)",
  openai: "OpenAI",
}

/** A single selectable model for the user, grouped by provider. */
export type SelectableModel = {
  provider: string
  providerLabel: string
  emoji: string
  status: CatalogStatus
  model: string
  modelLabel: string
  hint?: string
  configured: boolean
  active: boolean
}

/**
 * Build the user-facing model catalog for a kind. Every CATALOG model is listed
 * so the picker is rich, but only models whose provider is LIVE *and* has a
 * configured credential are marked selectable via `configured`. The currently
 * active provider's configured model is flagged `active` for preselection.
 * Never returns credentials.
 */
async function listSelectableModels(
  kind: CatalogKind,
  environment: Environment,
  repository: ProviderSettingsRepository,
): Promise<SelectableModel[]> {
  const rows = await repository.findConfiguredByKind(kind)
  const configuredByProvider = new Map<string, { model: string | null; enabled: boolean }>()
  for (const row of rows) {
    const key = catalogKeyForSlug(kind, row.slug)
    if (key && !configuredByProvider.has(key)) configuredByProvider.set(key, { model: row.model, enabled: row.enabled })
  }

  // Seedance stays "coming soon" until an admin confirms BytePlus has enabled the
  // account: until then every render is refused, which reads as a broken product.
  const seedanceAvailable = kind === "VIDEO" ? await repository.readFlag?.(SEEDANCE_AVAILABLE_KEY).catch(() => false) : false

  const models: SelectableModel[] = []
  for (const provider of catalogProviders(kind)) {
    const held = provider.key === "seedance" && !seedanceAvailable
    const configured = provider.status === "live" && !held && configuredByProvider.has(provider.key)
    const saved = configuredByProvider.get(provider.key)
    for (const model of provider.models) {
      models.push({
        provider: provider.key,
        providerLabel: provider.label,
        emoji: provider.emoji,
        status: held ? "planned" : provider.status,
        model: model.id,
        modelLabel: model.label,
        hint: model.hint,
        configured,
        active: configured && Boolean(saved?.enabled) && (saved?.model ?? defaultModelForKey(kind, provider.key, environment)) === model.id,
      })
    }
  }
  return models
}

export function listSelectableImageModels(
  environment: Environment = process.env,
  repository: ProviderSettingsRepository = prismaProviderSettingsRepository,
): Promise<SelectableModel[]> {
  return listSelectableModels("IMAGE", environment, repository)
}

export function listSelectableVideoModels(
  environment: Environment = process.env,
  repository: ProviderSettingsRepository = prismaProviderSettingsRepository,
): Promise<SelectableModel[]> {
  return listSelectableModels("VIDEO", environment, repository)
}

function catalogKeyForSlug(kind: CatalogKind, slug: string): string | null {
  if (kind === "IMAGE") {
    if (slug === "openai-image" || slug === "openai") return "openai"
    if (slug === "bfl-image") return "bfl"
    if (slug === "google-image" || slug === "catalog:google:image") return "google"
    return null
  }
  if (slug === "runway-video" || slug === "runway") return "runway"
  if (slug === "bfl-video") return "bfl"
  if (slug === "seedance-video") return "seedance"
  if (slug === "catalog:google:video") return "google"
  if (slug === "catalog:kling:video") return "kling"
  return null
}

function defaultModelForKey(kind: CatalogKind, key: string, environment: Environment): string {
  if (key === "bfl") return defaultModel(kind, "BFL", environment)
  if (key === "openai") return defaultModel(kind, "OPENAI", environment)
  if (key === "google") return defaultModel(kind, "GOOGLE", environment)
  if (key === "seedance") return defaultModel(kind, "SEEDANCE", environment)
  if (key === "kling") return defaultModel(kind, "KLING", environment)
  return defaultModel(kind, "RUNWAY", environment)
}

/**
 * List every image provider that is CONFIGURED (a decryptable credential row
 * exists), regardless of the enabled flag, so the user can freely pick any of
 * them. The `active` flag marks whichever is currently enabled. Never returns
 * credentials — only provider name, model, label, and which one is active.
 */
export async function listAvailableImageProviders(
  environment: Environment = process.env,
  repository: ProviderSettingsRepository = prismaProviderSettingsRepository,
): Promise<ImageProviderOption[]> {
  const rows = await repository.findConfiguredByKind("IMAGE")
  const seen = new Map<"openai" | "bfl", ImageProviderOption>()
  // Newest row wins per provider; a provider is "active" if its newest row is enabled.
  for (const row of rows) {
    const providerName = providerForSlug("IMAGE", row.slug)
    const key = providerName === "BFL" ? "bfl" : "openai"
    if (seen.has(key)) continue
    seen.set(key, {
      provider: key,
      model: row.model ?? defaultModel("IMAGE", providerName, environment),
      label: IMAGE_PROVIDER_LABELS[key],
      active: row.enabled,
    })
  }
  // Show FLUX first when present so the premium model leads the selector.
  return [...seen.values()].sort((a, b) => (a.provider === "bfl" ? -1 : b.provider === "bfl" ? 1 : 0))
}

/**
 * Resolve a SPECIFIC image provider chosen by the user. Prefers a configured
 * database row (enabled or not); falls back to the environment key only for
 * providers that support an env default.
 */
export type ImageProviderChoice = "openai" | "bfl" | "google"
export type VideoProviderChoice = "runway" | "bfl" | "seedance" | "google" | "kling"

const VIDEO_CHOICE_SLUGS: Record<VideoProviderChoice, string[]> = {
  runway: ["runway-video", "runway"],
  bfl: ["bfl-video"],
  seedance: ["seedance-video"],
  google: ["catalog:google:video"],
  kling: ["catalog:kling:video"],
}

const VIDEO_CHOICE_ENV: Record<VideoProviderChoice, string> = {
  runway: "RUNWAYML_API_SECRET",
  bfl: "BFL_API_KEY",
  seedance: "ARK_API_KEY",
  google: "GEMINI_API_KEY",
  kling: "KLING_API_KEY",
}

/** Resolve a SPECIFIC video provider chosen by the user (runway | bfl). */
export async function resolveVideoProviderByName(
  choice: VideoProviderChoice,
  modelOverride?: string,
  environment: Environment = process.env,
  repository: ProviderSettingsRepository = prismaProviderSettingsRepository,
  decrypt: (value: EncryptedCredential) => string = decryptCredential,
): Promise<ResolvedProviderSettings> {
  const safeModel = validCatalogModel("VIDEO", choice, modelOverride)
  const stored = await repository.findConfiguredBySlugs(VIDEO_CHOICE_SLUGS[choice])
  if (stored) {
    const provider = providerForSlug("VIDEO", stored.slug)
    return {
      provider,
      apiKey: decrypt(stored.encryptedCredential),
      model: safeModel ?? stored.model ?? defaultModel("VIDEO", provider, environment),
      endpoint: stored.endpoint ?? undefined,
      source: "database",
    }
  }
  const envKey = environment[VIDEO_CHOICE_ENV[choice]]
  if (!envKey) throw new Error(`${VIDEO_CHOICE_ENV[choice]} is required`)
  const provider: ProviderName = ({ bfl: "BFL", seedance: "SEEDANCE", google: "GOOGLE", kling: "KLING", runway: "RUNWAY" } as const)[choice]
  return { provider, apiKey: envKey, model: safeModel ?? defaultModel("VIDEO", provider, environment), endpoint: undefined, source: "environment" }
}

const IMAGE_CHOICE_SLUGS: Record<ImageProviderChoice, string[]> = {
  bfl: ["bfl-image"],
  openai: ["openai-image", "openai"],
  google: ["google-image", "catalog:google:image"],
}

const IMAGE_CHOICE_ENV: Record<ImageProviderChoice, string> = {
  bfl: "BFL_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
}

export async function resolveImageProviderByName(
  choice: ImageProviderChoice,
  modelOverride?: string,
  environment: Environment = process.env,
  repository: ProviderSettingsRepository = prismaProviderSettingsRepository,
  decrypt: (value: EncryptedCredential) => string = decryptCredential,
): Promise<ResolvedProviderSettings> {
  // Only accept a model that belongs to the chosen provider in the catalog.
  const safeModel = validCatalogModel("IMAGE", choice, modelOverride)
  const stored = await repository.findConfiguredBySlugs(IMAGE_CHOICE_SLUGS[choice])
  if (stored) {
    const provider = providerForSlug("IMAGE", stored.slug)
    return {
      provider,
      apiKey: decrypt(stored.encryptedCredential),
      model: safeModel ?? stored.model ?? defaultModel("IMAGE", provider, environment),
      endpoint: stored.endpoint ?? undefined,
      source: "database",
    }
  }
  const envKey = environment[IMAGE_CHOICE_ENV[choice]]
  if (!envKey) throw new Error(`${IMAGE_CHOICE_ENV[choice]} is required`)
  const provider = choice === "openai" ? "OPENAI" : choice === "bfl" ? "BFL" : "GOOGLE"
  return { provider, apiKey: envKey, model: safeModel ?? defaultModel("IMAGE", provider, environment), endpoint: undefined, source: "environment" }
}

/**
 * Validate that the requested model belongs to the chosen provider.
 *
 * Previously an unrecognised model id was silently dropped and the provider
 * default was used instead. That is the worst outcome available: a typo, or a
 * model retired from the catalogue, produced a successful render billed against
 * a different model than the one requested, with nothing in the response or the
 * logs to say so. An unknown id is now rejected so the caller learns about it.
 *
 * `undefined` still means "no preference" and falls through to the default.
 */
function validCatalogModel(kind: CatalogKind, providerKey: string, model: string | undefined): string | undefined {
  if (!model) return undefined
  const provider = catalogProviders(kind).find((entry) => entry.key === providerKey)
  if (!provider) throw new Error("UNKNOWN_PROVIDER")
  if (!provider.models.some((entry) => entry.id === model)) throw new Error("UNKNOWN_PROVIDER_MODEL")
  return model
}

/**
 * Resolve only the ACTIVE video provider's lowercase name for UI capability
 * gating. Unlike `resolveActiveProvider`, this never decrypts credentials — the
 * client only needs to know which provider is active, not any secret material.
 */
export async function resolveActiveVideoProviderName(
  environment: Environment = process.env,
  repository: ProviderSettingsRepository = prismaProviderSettingsRepository,
): Promise<VideoProviderChoice> {
  const stored = await repository.findActive("VIDEO")
  if (stored) {
    const provider = providerForSlug("VIDEO", stored.slug)
    return ({ BFL: "bfl", SEEDANCE: "seedance", GOOGLE: "google", KLING: "kling" } as Partial<Record<ProviderName, VideoProviderChoice>>)[provider] ?? "runway"
  }
  // Environment default for VIDEO is Runway; confirm the secret exists so the
  // page mirrors the same "not configured" boundary the API enforces.
  if (!environment.RUNWAYML_API_SECRET) throw new Error("RUNWAYML_API_SECRET is required")
  return "runway"
}

export async function resolveOpenAITextSettings(
  environment: Environment = process.env,
  repository: ProviderSettingsRepository = prismaProviderSettingsRepository,
  decrypt: (value: EncryptedCredential) => string = decryptCredential,
  textModels: (environment: Environment) => Promise<{ text: string }> = resolveTextModels,
): Promise<ResolvedProviderSettings> {
  // Admin → AI text, then OPENAI_TEXT_MODEL, then the default (src/lib/ai/text-models.ts).
  const { text: model } = await textModels(environment)
  const storedCandidates = await repository.findOpenAIImageCandidates()
  let latestDecryptionError: unknown
  for (const stored of storedCandidates) {
    try {
      return {
        provider: "OPENAI",
        apiKey: decrypt(stored.encryptedCredential),
        model,
        endpoint: undefined,
        source: "database",
      }
    } catch (error) {
      latestDecryptionError ??= error
    }
  }
  if (latestDecryptionError) throw latestDecryptionError
  if (!environment.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required")
  return {
    provider: "OPENAI",
    apiKey: environment.OPENAI_API_KEY,
    model,
    endpoint: undefined,
    source: "environment",
  }
}

/** @deprecated Use resolveActiveProvider or resolveOpenAITextSettings for new call sites. */
export async function resolveProviderSettings(
  kind: ProviderKind,
  provider: Exclude<ProviderName, "BFL">,
  environment: Environment = process.env,
) {
  const slugs = provider === "OPENAI" ? ["openai-image", "openai"] : ["runway-video", "runway"]
  const configuration = await getPrisma().aPIConfiguration.findFirst({
    where: { enabled: true, provider: { kind, slug: { in: slugs } } },
    orderBy: { createdAt: "desc" },
    select: { model: true, endpoint: true, encryptedCredential: true },
  })
  if (configuration?.encryptedCredential) {
    return {
      apiKey: decryptCredential(configuration.encryptedCredential as unknown as EncryptedCredential),
      model: configuration.model ?? defaultModel(kind, provider, environment),
      endpoint: configuration.endpoint ?? undefined,
      source: "database" as const,
    }
  }
  const apiKey = provider === "OPENAI" ? environment.OPENAI_API_KEY : environment.RUNWAYML_API_SECRET
  if (!apiKey) throw new Error(provider === "OPENAI" ? "OPENAI_API_KEY is required" : "RUNWAYML_API_SECRET is required")
  return { apiKey, model: defaultModel(kind, provider, environment), endpoint: undefined, source: "environment" as const }
}

function providerForSlug(kind: ProviderKind, slug: string): ProviderName {
  if (kind === "IMAGE" && (slug === "openai-image" || slug === "openai")) return "OPENAI"
  if (kind === "VIDEO" && (slug === "runway-video" || slug === "runway")) return "RUNWAY"
  if (kind === "IMAGE" && slug === "bfl-image") return "BFL"
  if (kind === "VIDEO" && slug === "bfl-video") return "BFL"
  if (kind === "VIDEO" && slug === "seedance-video") return "SEEDANCE"
  if (kind === "VIDEO" && slug === "catalog:google:video") return "GOOGLE"
  if (kind === "VIDEO" && slug === "catalog:kling:video") return "KLING"
  if (kind === "IMAGE" && (slug === "google-image" || slug === "catalog:google:image")) return "GOOGLE"
  throw new Error("Unsupported active provider configuration")
}

function defaultModel(kind: ProviderKind, provider: ProviderName, environment: Environment) {
  if (provider === "BFL") return kind === "IMAGE" ? (environment.BFL_IMAGE_MODEL ?? "flux-2-pro") : (environment.BFL_VIDEO_MODEL ?? "flux-3-video")
  if (provider === "RUNWAY") return environment.RUNWAY_VIDEO_MODEL ?? "gen4.5"
  if (provider === "SEEDANCE") return environment.SEEDANCE_VIDEO_MODEL ?? "dreamina-seedance-2-5-260628"
  if (provider === "KLING") return environment.KLING_VIDEO_MODEL ?? "kling-3.0"
  if (provider === "GOOGLE" && kind === "VIDEO") return environment.VEO_VIDEO_MODEL ?? "veo-3.1-fast-generate-preview"
  if (provider === "GOOGLE") return environment.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image"
  return environment.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5"
}

function storedSettings(row: { provider: { slug: string }; model: string | null; endpoint: string | null; encryptedCredential: unknown; enabled?: boolean }): StoredSettings | null {
  if (!row.encryptedCredential) return null
  return {
    slug: row.provider.slug,
    model: row.model,
    endpoint: row.endpoint,
    encryptedCredential: row.encryptedCredential as EncryptedCredential,
    enabled: row.enabled ?? true,
  }
}

const prismaProviderSettingsRepository: ProviderSettingsRepository = {
  async readFlag(key) {
    const row = await getPrisma().systemSetting.findUnique({ where: { key } })
    return row?.value === true
  },
  async findActive(kind) {
    const configuration = await getPrisma().aPIConfiguration.findFirst({
      where: { enabled: true, provider: { kind } },
      orderBy: { createdAt: "desc" },
      select: { model: true, endpoint: true, encryptedCredential: true, provider: { select: { slug: true } } },
    })
    if (!configuration) return null
    const stored = storedSettings(configuration)
    if (!stored) throw new Error("Stored provider credential is unreadable")
    return stored
  },
  async findOpenAIImageCandidates() {
    const configurations = await getPrisma().aPIConfiguration.findMany({
      where: { provider: { kind: "IMAGE", slug: { in: ["openai-image", "openai"] } } },
      orderBy: { createdAt: "desc" },
      select: { model: true, endpoint: true, encryptedCredential: true, provider: { select: { slug: true } } },
    })
    return configurations.map((configuration) => ({
      slug: configuration.provider.slug,
      model: configuration.model,
      endpoint: configuration.endpoint,
      encryptedCredential: configuration.encryptedCredential as unknown as EncryptedCredential,
      enabled: true,
    }))
  },
  async findEnabledByKind(kind) {
    const configurations = await getPrisma().aPIConfiguration.findMany({
      where: { enabled: true, provider: { kind } },
      orderBy: { createdAt: "desc" },
      select: { model: true, endpoint: true, encryptedCredential: true, provider: { select: { slug: true } } },
    })
    return configurations
      .map((configuration) => storedSettings(configuration))
      .filter((settings): settings is StoredSettings => settings !== null)
  },
  async findEnabledBySlugs(slugs) {
    const configuration = await getPrisma().aPIConfiguration.findFirst({
      where: { enabled: true, provider: { slug: { in: slugs } } },
      orderBy: { createdAt: "desc" },
      select: { model: true, endpoint: true, encryptedCredential: true, enabled: true, provider: { select: { slug: true } } },
    })
    if (!configuration) return null
    return storedSettings(configuration)
  },
  async findConfiguredByKind(kind) {
    // Every configured row (enabled or not), newest first, so the selector can
    // offer any provider the operator has connected credentials for.
    const configurations = await getPrisma().aPIConfiguration.findMany({
      where: { provider: { kind } },
      orderBy: { createdAt: "desc" },
      select: { model: true, endpoint: true, encryptedCredential: true, enabled: true, provider: { select: { slug: true } } },
    })
    return configurations
      .map((configuration) => storedSettings(configuration))
      .filter((settings): settings is StoredSettings => settings !== null)
  },
  async findConfiguredBySlugs(slugs) {
    // Prefer an enabled row, else the newest configured row for the slug set.
    const configurations = await getPrisma().aPIConfiguration.findMany({
      where: { provider: { slug: { in: slugs } } },
      orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
      select: { model: true, endpoint: true, encryptedCredential: true, enabled: true, provider: { select: { slug: true } } },
    })
    for (const configuration of configurations) {
      const stored = storedSettings(configuration)
      if (stored) return stored
    }
    return null
  },
}
