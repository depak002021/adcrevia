import { z } from "zod"

import { getPrisma } from "@/lib/db/prisma"
import { encryptCredential, maskCredential } from "@/lib/encryption/provider-credentials"
import { HttpError } from "@/lib/http/http-error"
import { catalogProviders, findCatalogProvider, type CatalogKind } from "@/lib/providers/catalog"

type AdminActor = { id: string; role: "USER" | "SUPER_ADMIN" }

/**
 * Slug used to store a catalog provider's key. For live providers we keep the
 * existing operational slugs (openai-image, bfl-image, runway-video, bfl-video)
 * so generation keeps working; for planned providers we use a namespaced slug
 * that never collides with an operational one.
 */
export function catalogSlug(kind: CatalogKind, key: string): string {
  if (kind === "IMAGE" && key === "openai") return "openai-image"
  if (kind === "IMAGE" && key === "bfl") return "bfl-image"
  if (kind === "IMAGE" && key === "google") return "google-image"
  if (kind === "VIDEO" && key === "runway") return "runway-video"
  if (kind === "VIDEO" && key === "bfl") return "bfl-video"
  if (kind === "VIDEO" && key === "seedance") return "seedance-video"
  return `catalog:${key}:${kind.toLowerCase()}`
}

const saveSchema = z.object({
  kind: z.enum(["IMAGE", "VIDEO"]),
  provider: z.string().min(1).max(40),
  apiKey: z.string().trim().min(8).max(400),
})

function assertSuperAdmin(admin: AdminActor) {
  if (admin.role !== "SUPER_ADMIN") throw new HttpError(403, "Forbidden")
}

/**
 * Store an encrypted API key for any catalog provider. This captures keys for
 * providers ahead of adapter support; it does NOT enable/activate the provider
 * for generation (only live providers with real adapters generate).
 */
export async function saveCatalogProviderKey(raw: unknown, admin: AdminActor) {
  assertSuperAdmin(admin)
  const input = saveSchema.parse(raw)
  const catalog = findCatalogProvider(input.kind, input.provider)
  if (!catalog) throw new HttpError(400, "Unknown provider.")

  const slug = catalogSlug(input.kind, input.provider)
  const db = getPrisma()
  const provider = await db.aIProvider.upsert({
    where: { slug },
    create: { slug, name: catalog.label, kind: input.kind },
    update: { name: catalog.label },
  })
  // One credential row per catalog provider slug: update if present, else create.
  const existing = await db.aPIConfiguration.findFirst({ where: { providerId: provider.id }, orderBy: { createdAt: "desc" } })
  const encryptedCredential = encryptCredential(input.apiKey)
  if (existing) {
    await db.aPIConfiguration.update({ where: { id: existing.id }, data: { encryptedCredential } })
  } else {
    await db.aPIConfiguration.create({
      data: {
        providerId: provider.id,
        name: `${catalog.label} ${input.kind.toLowerCase()}`,
        model: catalog.models[0]?.id ?? null,
        endpoint: null,
        encryptedCredential,
        // Never auto-enable a planned provider; live providers are activated
        // through their own dedicated save flows.
        enabled: false,
      },
    })
  }
  return { ok: true, provider: input.provider, apiKey: maskCredential() }
}

export type CatalogProviderStatus = {
  provider: string
  label: string
  emoji: string
  status: "live" | "planned"
  apiKeyEnvVar: string
  apiKeyPlaceholder: string
  docsUrl?: string
  models: { id: string; label: string; hint?: string }[]
  hasKey: boolean
}

/** List every catalog provider for a kind with whether a key is on file. */
export async function listCatalogProviderStatus(kind: CatalogKind, admin: AdminActor): Promise<CatalogProviderStatus[]> {
  assertSuperAdmin(admin)
  const db = getPrisma()
  const providers = catalogProviders(kind)
  const slugs = providers.map((provider) => catalogSlug(kind, provider.key))
  const rows = await db.aPIConfiguration.findMany({
    where: { provider: { slug: { in: slugs } } },
    select: { provider: { select: { slug: true } } },
  })
  const configuredSlugs = new Set(rows.map((row) => row.provider.slug))
  return providers.map((provider) => ({
    provider: provider.key,
    label: provider.label,
    emoji: provider.emoji,
    status: provider.status,
    apiKeyEnvVar: provider.apiKeyEnvVar,
    apiKeyPlaceholder: provider.apiKeyPlaceholder,
    docsUrl: provider.docsUrl,
    models: provider.models,
    hasKey: configuredSlugs.has(catalogSlug(kind, provider.key)),
  }))
}
