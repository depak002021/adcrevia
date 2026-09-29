import { randomBytes } from "node:crypto"

import { getPrisma } from "@/lib/db/prisma"
import { encryptCredential } from "@/lib/encryption/provider-credentials"
import { HttpError } from "@/lib/http/http-error"
import { describeStorage, normalizeEndpoint, resolveStorageSettings, STORAGE_SLUG } from "@/lib/storage/configuration"
import { createStorageProvider } from "@/lib/storage/runtime"

import { storageConfigurationSchema } from "./schemas"

/**
 * Connecting a bucket from the console.
 *
 * Storage was environment-only, which meant the one piece of configuration most likely
 * to change after launch — a rotated key, a new bucket, a move to a different account —
 * required a deploy. It is now a row, encrypted at rest, with the environment kept as a
 * fallback so an existing host keeps working untouched.
 *
 * Saving writes a new configuration row and deactivates the previous one rather than
 * updating in place. The old row stays as a record of what was configured and when,
 * which is the difference between "somebody changed the bucket last Tuesday" and a
 * mystery.
 */

type AdminActor = { id: string; role: "USER" | "SUPER_ADMIN" }

export type StorageStatus = {
  configured: boolean
  source: "database" | "environment" | "none"
  endpoint: string
  bucket: string
  publicBaseUrl: string
  lastTestedAt: Date | null
  lastTestSucceeded: boolean | null
  safeTestMessage: string | null
}

export async function readStorageStatus(): Promise<StorageStatus> {
  const [described, row] = await Promise.all([
    describeStorage(),
    getPrisma().aPIConfiguration.findFirst({
      where: { provider: { kind: "STORAGE", slug: STORAGE_SLUG } },
      orderBy: { createdAt: "desc" },
      select: { lastTestedAt: true, lastTestSucceeded: true, safeTestMessage: true },
    }),
  ])

  return {
    configured: described.configured,
    source: described.source,
    endpoint: described.settings?.endpoint ?? "",
    bucket: described.settings?.bucket ?? "",
    publicBaseUrl: described.settings?.publicBaseUrl ?? "",
    lastTestedAt: row?.lastTestedAt ?? null,
    lastTestSucceeded: row?.lastTestSucceeded ?? null,
    safeTestMessage: row?.safeTestMessage ?? null,
  }
}

export async function saveStorageConfiguration(raw: unknown, admin: AdminActor): Promise<StorageStatus> {
  assertSuperAdmin(admin)
  const input = storageConfigurationSchema.parse(raw)
  const db = getPrisma()

  await db.$transaction(async (transaction) => {
    const provider = await transaction.aIProvider.upsert({
      where: { slug: STORAGE_SLUG },
      create: { slug: STORAGE_SLUG, name: "Cloudflare R2", kind: "STORAGE" },
      update: { enabled: true },
    })

    // Exactly one active configuration. Two would make which bucket receives an upload
    // depend on row ordering.
    await transaction.aPIConfiguration.updateMany({
      where: { providerId: provider.id, enabled: true },
      data: { enabled: false },
    })

    await transaction.aPIConfiguration.create({
      data: {
        providerId: provider.id,
        name: `R2 ${input.bucket}`,
        // Both halves of the key pair in one encrypted blob: they are useless apart and
        // storing them separately would mean two decrypt calls and a way to get out of
        // step.
        encryptedCredential: encryptCredential(
          JSON.stringify({ accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey }),
        ),
        settings: {
          endpoint: normalizeEndpoint(input.endpoint),
          bucket: input.bucket,
          publicBaseUrl: input.publicBaseUrl.replace(/\/$/, ""),
        },
        enabled: true,
      },
    })
  })

  return readStorageStatus()
}

/**
 * Prove the credentials work by actually writing an object.
 *
 * A read or a bucket-exists check would pass with credentials that cannot write, which
 * is the permission that matters: every use of this provider is an upload. The probe
 * object is small, randomly named and deleted afterwards — and a delete failure is not
 * treated as a test failure, because write access is what was being tested.
 */
export async function testStorageConfiguration(raw: unknown, admin: AdminActor): Promise<StorageStatus> {
  assertSuperAdmin(admin)

  // An empty body means "test what is already saved", which is the useful case after a
  // key rotation elsewhere.
  const parsed = storageConfigurationSchema.safeParse(raw)

  const key = `healthcheck/${randomBytes(12).toString("hex")}.txt`
  let ok = false
  let safeTestMessage = "Connected."

  try {
    // Resolved inside the try: with nothing saved, resolveStorageSettings throws
    // R2_STORAGE_CONFIG_REQUIRED, which must reach the admin as "Nothing is configured
    // yet." rather than escape as a 500.
    const settings = parsed.success
      ? ({
          kind: "r2" as const,
          endpoint: normalizeEndpoint(parsed.data.endpoint),
          accessKeyId: parsed.data.accessKeyId,
          secretAccessKey: parsed.data.secretAccessKey,
          bucket: parsed.data.bucket,
          publicBaseUrl: parsed.data.publicBaseUrl.replace(/\/$/, ""),
          source: "database" as const,
        })
      : await resolveStorageSettings()
    const provider = await createStorageProvider(settings)
    const stored = await provider.put({
      key,
      bytes: new TextEncoder().encode("adcrevia storage check"),
      contentType: "text/plain",
    })
    // Writing is half of it. Browsers and AI providers read every file through the
    // public URL, and a bucket that accepts writes but serves nothing publicly passed
    // this test while every generated image appeared broken.
    const publicRead = await fetch(stored.url, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
    await publicRead?.body?.cancel().catch(() => {})
    if (publicRead?.ok) {
      ok = true
    } else {
      safeTestMessage =
        "Upload works, but the file is not readable at the Public base URL. Enable public access on the bucket (r2.dev URL or a custom domain) and use that URL."
    }
    // Best-effort: the write is what was being tested, and a bucket with a
    // write-but-not-delete policy is a valid configuration.
    await provider.delete?.(key).catch(() => {})
  } catch (error) {
    // Categories, not the provider's message. An S3 error can echo the endpoint, the
    // bucket and occasionally part of a signature.
    safeTestMessage = categoriseStorageError(error)
  }

  await getPrisma()
    .aPIConfiguration.updateMany({
      where: { enabled: true, provider: { kind: "STORAGE", slug: STORAGE_SLUG } },
      data: { lastTestedAt: new Date(), lastTestSucceeded: ok, safeTestMessage },
    })
    .catch(() => {
      // Nothing saved yet: testing before saving is a normal thing to do.
    })

  const status = await readStorageStatus()
  return { ...status, lastTestedAt: new Date(), lastTestSucceeded: ok, safeTestMessage }
}

function categoriseStorageError(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : ""
  const status =
    error && typeof error === "object" && "$metadata" in error
      ? Number((error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode ?? 0)
      : 0

  if (name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch" || status === 403) {
    return "The credentials were rejected."
  }
  if (name === "NoSuchBucket" || status === 404) return "That bucket does not exist."
  if (error instanceof Error && error.message === "R2_STORAGE_CONFIG_REQUIRED") {
    return "Nothing is configured yet."
  }
  if (error instanceof Error && error.message === "R2_STORAGE_CONFIG_INCOMPLETE") {
    return "The saved configuration is incomplete."
  }
  return "The bucket could not be reached."
}

function assertSuperAdmin(admin: AdminActor) {
  if (admin.role !== "SUPER_ADMIN") throw new HttpError(403, "Forbidden")
}
