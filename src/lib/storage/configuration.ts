import { join } from "node:path"

import { getPrisma } from "@/lib/db/prisma"
import { decryptCredential, type EncryptedCredential } from "@/lib/encryption/provider-credentials"

/**
 * Where generated media goes.
 *
 * Resolution order is database, then environment, mirroring how image and video
 * providers already work. An administrator connecting a bucket should not need a
 * deploy, and an operator who has only ever set environment variables should not need
 * to visit the console.
 *
 * The credential pair is encrypted at rest in `encryptedCredential`. Everything else —
 * endpoint, bucket, public base URL — lives in the `settings` column, because those are
 * not secret and the console has to be able to show them without decrypting anything.
 */

/** Slug the storage configuration is stored under. */
export const STORAGE_SLUG = "storage-r2"

export type R2Settings = {
  kind: "r2"
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBaseUrl: string
  source: "database" | "environment"
}

export type LocalSettings = {
  kind: "local"
  root: string
  publicBaseUrl: string
  source: "default"
}

export type StorageSettings = R2Settings | LocalSettings

/** Non-secret half of the configuration, safe to return to the console. */
export type StoragePublicSettings = {
  endpoint: string
  bucket: string
  publicBaseUrl: string
}

type Environment = Record<string, string | undefined>

const R2_ENV_KEYS = [
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
] as const

export type StorageSettingsRepository = {
  findActive(): Promise<{ settings: unknown; encryptedCredential: unknown } | null>
}

/**
 * Read the stored configuration, treating an unreachable database as "nothing stored".
 *
 * A `try`/`catch` rather than `.catch()` on the returned promise, because `getPrisma()`
 * throws SYNCHRONOUSLY when `DATABASE_URL` is absent — so the promise is never created
 * and a `.catch()` never runs. That distinction is the difference between falling back
 * to the environment and every single upload failing.
 */
async function readStored(repository: StorageSettingsRepository) {
  try {
    return await repository.findActive()
  } catch {
    return null
  }
}

export async function resolveStorageSettings(
  environment: Environment = process.env,
  repository: StorageSettingsRepository = prismaStorageSettingsRepository,
  decrypt: (value: EncryptedCredential) => string = decryptCredential,
  production = process.env.NODE_ENV === "production",
): Promise<StorageSettings> {
  const stored = await readStored(repository)
  if (stored?.encryptedCredential) {
    const settings = asRecord(stored.settings)
    const credential = readCredentialPair(decrypt(stored.encryptedCredential as EncryptedCredential))
    const endpoint = readString(settings?.endpoint)
    const bucket = readString(settings?.bucket)
    const publicBaseUrl = readString(settings?.publicBaseUrl)

    // A half-written row is worse than no row: it would silently fall through to the
    // environment and write objects into a different bucket than the console shows.
    if (!endpoint || !bucket || !publicBaseUrl || !credential) throw new Error("R2_STORAGE_CONFIG_INCOMPLETE")

    return {
      kind: "r2",
      endpoint: normalizeEndpoint(endpoint),
      bucket,
      publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
      ...credential,
      source: "database",
    }
  }

  const present = R2_ENV_KEYS.filter((key) => Boolean(environment[key]))
  if (present.length === R2_ENV_KEYS.length) {
    return {
      kind: "r2",
      endpoint: normalizeEndpoint(environment.R2_ENDPOINT!),
      accessKeyId: environment.R2_ACCESS_KEY_ID!,
      secretAccessKey: environment.R2_SECRET_ACCESS_KEY!,
      bucket: environment.R2_BUCKET!,
      publicBaseUrl: environment.R2_PUBLIC_BASE_URL!.replace(/\/$/, ""),
      source: "environment",
    }
  }

  // Partially configured is a mistake, not a preference. Falling back to writing files
  // onto the container's own disk would look like it worked until the container was
  // replaced and every generated asset disappeared with it.
  if (present.length > 0 || production) throw new Error("R2_STORAGE_CONFIG_REQUIRED")

  const appUrl = (environment.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
  return {
    kind: "local",
    root: join(process.cwd(), "public", "generated"),
    publicBaseUrl: `${appUrl}/generated`,
    source: "default",
  }
}

/**
 * What the console is allowed to see.
 *
 * Never the credential, not even masked from the real value — `maskCredential` returns a
 * fixed placeholder precisely so the length of a secret cannot be inferred from it.
 */
export async function describeStorage(
  environment: Environment = process.env,
  repository: StorageSettingsRepository = prismaStorageSettingsRepository,
): Promise<{ configured: boolean; source: "database" | "environment" | "none"; settings: StoragePublicSettings | null }> {
  const stored = await readStored(repository)
  if (stored?.encryptedCredential) {
    const settings = asRecord(stored.settings)
    return {
      configured: true,
      source: "database",
      settings: {
        endpoint: readString(settings?.endpoint) ?? "",
        bucket: readString(settings?.bucket) ?? "",
        publicBaseUrl: readString(settings?.publicBaseUrl) ?? "",
      },
    }
  }

  if (R2_ENV_KEYS.every((key) => Boolean(environment[key]))) {
    return {
      configured: true,
      source: "environment",
      settings: {
        endpoint: environment.R2_ENDPOINT!,
        bucket: environment.R2_BUCKET!,
        publicBaseUrl: environment.R2_PUBLIC_BASE_URL!,
      },
    }
  }

  return { configured: false, source: "none", settings: null }
}

/**
 * The S3 endpoint is an origin: `https://<account>.r2.cloudflarestorage.com`.
 *
 * Cloudflare's dashboard shows the endpoint WITH the bucket appended, and pasting that
 * made the S3 client prefix every key with the path — objects landed at
 * `adcrevia-bucket//projects/...` while their public URLs pointed at `projects/...`,
 * so every stored image and video 404'd. Only scheme and host are ever used.
 */
export function normalizeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint.trim())
    return `${url.protocol}//${url.host}`
  } catch {
    return endpoint.trim()
  }
}

function readCredentialPair(plaintext: string): { accessKeyId: string; secretAccessKey: string } | null {
  try {
    const parsed = JSON.parse(plaintext) as { accessKeyId?: unknown; secretAccessKey?: unknown }
    if (typeof parsed.accessKeyId !== "string" || typeof parsed.secretAccessKey !== "string") return null
    if (!parsed.accessKeyId || !parsed.secretAccessKey) return null
    return { accessKeyId: parsed.accessKeyId, secretAccessKey: parsed.secretAccessKey }
  } catch {
    // Not JSON. An older row, or one written by hand. Treated as unusable rather than
    // guessed at, because guessing here means writing objects with the wrong identity.
    return null
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const prismaStorageSettingsRepository: StorageSettingsRepository = {
  findActive() {
    return getPrisma().aPIConfiguration.findFirst({
      where: { enabled: true, provider: { kind: "STORAGE", slug: STORAGE_SLUG } },
      orderBy: { createdAt: "desc" },
      select: { settings: true, encryptedCredential: true },
    })
  },
}
