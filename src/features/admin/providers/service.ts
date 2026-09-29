import RunwayML from "@runwayml/sdk"
import OpenAI from "openai"

import { getPrisma } from "@/lib/db/prisma"
import { encryptCredential, maskCredential, type EncryptedCredential } from "@/lib/encryption/provider-credentials"
import { HttpError } from "@/lib/http/http-error"
import {
  bflConfigurationSchema,
  providerConfigurationSchema,
  type ProviderConfigurationInput,
} from "./schemas"

type AdminActor = { id: string; role: "USER" | "SUPER_ADMIN" }
type ProviderName = "OPENAI" | "RUNWAY" | "BFL"
type ProviderKind = "IMAGE" | "VIDEO"
type ProviderSlug = "openai-image" | "runway-video" | "bfl-image" | "bfl-video"

const PROVIDER_ACTIVATION_LOCK = {
  IMAGE: 71780737523713,
  VIDEO: 71780737523714,
} as const satisfies Record<ProviderKind, number>

type StoredProvider = Omit<ProviderConfigurationInput, "apiKey" | "provider"> & {
  id: string
  provider: ProviderName
  encryptedCredential: EncryptedCredential
  lastTestedAt: Date | null
  lastTestSucceeded: boolean | null
  safeTestMessage: string | null
}

type ProviderWrite = {
  kind: ProviderKind
  provider: ProviderName
  slug: ProviderSlug
  name: string
  model: string
  endpoint: string
  enabled: boolean
  encryptedCredential: EncryptedCredential
}

type SingleProviderRepository = {
  save(input: ProviderWrite): Promise<StoredProvider>
  list(kind: ProviderKind): Promise<StoredProvider[]>
}

type BflProviderRepository = {
  saveBfl(inputs: [ProviderWrite, ProviderWrite]): Promise<StoredProvider[]>
}

export type ProviderRepository = SingleProviderRepository & BflProviderRepository

export async function saveProviderConfiguration(raw: unknown, admin: AdminActor, repository: SingleProviderRepository = prismaProviderRepository) {
  assertSuperAdmin(admin)
  const input = providerConfigurationSchema.parse(raw)
  const identity = input.provider === "OPENAI"
    ? { slug: "openai-image" as const, name: "OpenAI" }
    : { slug: "runway-video" as const, name: "Runway" }
  return repository.save({
    kind: input.kind,
    provider: input.provider,
    ...identity,
    model: input.model,
    endpoint: input.endpoint ?? "",
    enabled: input.enabled,
    encryptedCredential: encryptCredential(input.apiKey),
  })
}

export async function saveBflConfigurations(raw: unknown, admin: AdminActor, repository: BflProviderRepository = prismaProviderRepository) {
  assertSuperAdmin(admin)
  const input = bflConfigurationSchema.parse(raw)
  const rows: [ProviderWrite, ProviderWrite] = [
    {
      kind: "IMAGE",
      provider: "BFL",
      slug: "bfl-image",
      name: "Black Forest Labs",
      model: input.imageModel,
      endpoint: "",
      enabled: input.imageEnabled,
      encryptedCredential: encryptCredential(input.apiKey),
    },
    {
      kind: "VIDEO",
      provider: "BFL",
      slug: "bfl-video",
      name: "Black Forest Labs",
      model: input.videoModel,
      endpoint: "",
      enabled: input.videoEnabled,
      encryptedCredential: encryptCredential(input.apiKey),
    },
  ]
  return (await repository.saveBfl(rows)).map(maskStoredProvider)
}

export async function listMaskedProviders(kind: ProviderKind, repository: SingleProviderRepository = prismaProviderRepository) {
  const rows = await repository.list(kind)
  return rows.map(maskStoredProvider)
}

export async function testProviderConfiguration(raw: unknown, admin: AdminActor) {
  assertSuperAdmin(admin)
  const input = providerConfigurationSchema.parse(raw)
  try {
    if (input.provider === "OPENAI") {
      await new OpenAI({ apiKey: input.apiKey }).models.retrieve(input.model)
    } else {
      await new RunwayML({ apiKey: input.apiKey }).organization.retrieve()
    }
    return { ok: true, category: "CONNECTED", testedAt: new Date().toISOString() }
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0
    const category = status === 401 || status === 403 ? "AUTHENTICATION_FAILED" : status === 429 ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE"
    return { ok: false, category, testedAt: new Date().toISOString() }
  }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export async function testBflCredential(raw: unknown, admin: AdminActor, fetcher: Fetcher = fetch) {
  assertSuperAdmin(admin)
  const { apiKey } = bflConfigurationSchema.pick({ apiKey: true }).parse(raw)
  try {
    const response = await fetcher("https://api.bfl.ai/v1/credits", {
      method: "GET",
      headers: { "x-key": apiKey },
    })
    if (!response.ok) return failedTestResult(safeBflCategory(response.status))
    const body: unknown = await response.json().catch(() => null)
    if (!body || typeof body !== "object" || !("credits" in body) || typeof body.credits !== "number" || !Number.isFinite(body.credits)) {
      return failedTestResult("PROVIDER_UNAVAILABLE")
    }
    return { ok: true, category: "CONNECTED" as const, testedAt: new Date().toISOString() }
  } catch {
    return failedTestResult("PROVIDER_UNAVAILABLE")
  }
}

function safeBflCategory(status: number) {
  if (status === 401 || status === 403) return "AUTHENTICATION_FAILED" as const
  if (status === 429) return "RATE_LIMITED" as const
  return "PROVIDER_UNAVAILABLE" as const
}

function failedTestResult(category: "AUTHENTICATION_FAILED" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE") {
  return { ok: false, category, testedAt: new Date().toISOString() }
}

function maskStoredProvider({ encryptedCredential: _encryptedCredential, ...row }: StoredProvider) {
  return { ...row, apiKey: maskCredential() }
}

function assertSuperAdmin(admin: AdminActor) {
  if (admin.role !== "SUPER_ADMIN") throw new HttpError(403, "Forbidden")
}

const prismaProviderRepository: ProviderRepository = {
  async save(input) {
    const db = getPrisma()
    return db.$transaction(async (transaction) => {
      // pg_advisory_xact_lock() returns void, which the pg driver adapter cannot
      // deserialize as a query result. Use $executeRaw (row count) instead of
      // $queryRaw so the lock is acquired without deserializing a void column.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${PROVIDER_ACTIVATION_LOCK[input.kind]} AS BIGINT))`
      const provider = await transaction.aIProvider.upsert({
        where: { slug: input.slug },
        create: { slug: input.slug, name: input.name, kind: input.kind },
        update: { enabled: true },
      })
      await transaction.aPIConfiguration.updateMany({
        where: { providerId: provider.id, enabled: true },
        data: { enabled: false },
      })
      if (input.enabled) {
        await transaction.aPIConfiguration.updateMany({
          where: { enabled: true, provider: { kind: input.kind } },
          data: { enabled: false },
        })
      }
      const configuration = await transaction.aPIConfiguration.create({
        data: {
          providerId: provider.id,
          name: `${provider.name} ${input.kind.toLowerCase()}`,
          model: input.model,
          endpoint: input.endpoint || null,
          encryptedCredential: input.encryptedCredential,
          enabled: input.enabled,
        },
      })
      return {
        id: configuration.id,
        kind: input.kind,
        provider: input.provider,
        model: configuration.model!,
        endpoint: configuration.endpoint ?? "",
        enabled: configuration.enabled,
        encryptedCredential: input.encryptedCredential,
        lastTestedAt: configuration.lastTestedAt,
        lastTestSucceeded: configuration.lastTestSucceeded,
        safeTestMessage: configuration.safeTestMessage,
      }
    })
  },
  async saveBfl(inputs) {
    const db = getPrisma()
    return db.$transaction(async (transaction) => {
      // pg_advisory_xact_lock() returns void; use $executeRaw (row count) so the
      // pg driver adapter never tries to deserialize a void column result.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${PROVIDER_ACTIVATION_LOCK.IMAGE} AS BIGINT))`
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${PROVIDER_ACTIVATION_LOCK.VIDEO} AS BIGINT))`
      const stored: StoredProvider[] = []
      for (const input of inputs) {
        const provider = await transaction.aIProvider.upsert({
          where: { slug: input.slug },
          create: { slug: input.slug, name: input.name, kind: input.kind },
          update: { enabled: true },
        })
        await transaction.aPIConfiguration.updateMany({
          where: { providerId: provider.id, enabled: true },
          data: { enabled: false },
        })
        if (input.enabled) {
          await transaction.aPIConfiguration.updateMany({
            where: { enabled: true, provider: { kind: input.kind } },
            data: { enabled: false },
          })
        }
        const configuration = await transaction.aPIConfiguration.create({
          data: {
            providerId: provider.id,
            name: `${provider.name} ${input.kind.toLowerCase()}`,
            model: input.model,
            endpoint: null,
            encryptedCredential: input.encryptedCredential,
            enabled: input.enabled,
          },
        })
        stored.push({
          id: configuration.id,
          kind: input.kind,
          provider: "BFL",
          model: configuration.model!,
          endpoint: configuration.endpoint ?? "",
          enabled: configuration.enabled,
          encryptedCredential: input.encryptedCredential,
          lastTestedAt: configuration.lastTestedAt,
          lastTestSucceeded: configuration.lastTestSucceeded,
          safeTestMessage: configuration.safeTestMessage,
        })
      }
      return stored
    })
  },
  async list(kind) {
    const rows = await getPrisma().aPIConfiguration.findMany({
      where: { provider: { kind } },
      orderBy: { createdAt: "desc" },
      include: { provider: true },
    })
    return rows.map((row) => ({
      id: row.id,
      kind,
      provider: providerNameFromSlug(row.provider.slug),
      model: row.model ?? "",
      endpoint: row.endpoint ?? "",
      enabled: row.enabled,
      encryptedCredential: row.encryptedCredential as unknown as EncryptedCredential,
      lastTestedAt: row.lastTestedAt,
      lastTestSucceeded: row.lastTestSucceeded,
      safeTestMessage: row.safeTestMessage,
    }))
  },
}

function providerNameFromSlug(slug: string): ProviderName {
  if (slug === "openai" || slug === "openai-image") return "OPENAI"
  if (slug === "runway" || slug === "runway-video") return "RUNWAY"
  if (slug === "bfl-image" || slug === "bfl-video") return "BFL"
  throw new Error("Unsupported provider configuration")
}
