import { describe, expect, it, vi } from "vitest"

import { resolveStorageSettings, type StorageSettingsRepository } from "./configuration"
import { createStorageProvider } from "./runtime"

/**
 * Storage resolution is worth pinning because the worst outcome is silent. A
 * misconfigured bucket that falls back to the container's own disk looks like it works
 * until the container is replaced and every generated asset disappears with it.
 */

const fullEnvironment = {
  R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "adcrevia-media",
  R2_PUBLIC_BASE_URL: "https://media.example.com/",
}

function repository(row: { settings: unknown; encryptedCredential: unknown } | null = null): StorageSettingsRepository {
  return { findActive: vi.fn(async () => row) }
}

const decrypt = () => JSON.stringify({ accessKeyId: "stored-key", secretAccessKey: "stored-secret" })

describe("resolveStorageSettings", () => {
  it("prefers an administrator's stored bucket over the environment", async () => {
    const settings = await resolveStorageSettings(
      fullEnvironment,
      repository({
        settings: {
          endpoint: "https://stored.r2.cloudflarestorage.com",
          bucket: "stored-bucket",
          publicBaseUrl: "https://cdn.stored.example",
        },
        encryptedCredential: { version: 1 },
      }),
      decrypt,
    )

    expect(settings).toMatchObject({
      kind: "r2",
      source: "database",
      bucket: "stored-bucket",
      accessKeyId: "stored-key",
    })
  })

  it("rejects a half-written row rather than falling through to the environment", async () => {
    // Falling through would write objects into a different bucket than the console is
    // showing, with nothing to say so.
    await expect(
      resolveStorageSettings(
        fullEnvironment,
        repository({ settings: { bucket: "stored-bucket" }, encryptedCredential: { version: 1 } }),
        decrypt,
      ),
    ).rejects.toThrow("R2_STORAGE_CONFIG_INCOMPLETE")
  })

  it("rejects a credential blob that is not the expected pair", async () => {
    await expect(
      resolveStorageSettings(
        fullEnvironment,
        repository({
          settings: { endpoint: "https://e", bucket: "b", publicBaseUrl: "https://p" },
          encryptedCredential: { version: 1 },
        }),
        () => "not-json",
      ),
    ).rejects.toThrow("R2_STORAGE_CONFIG_INCOMPLETE")
  })

  it("falls back to the environment when nothing is stored", async () => {
    const settings = await resolveStorageSettings(fullEnvironment, repository(), decrypt)
    expect(settings).toMatchObject({ kind: "r2", source: "environment", bucket: "adcrevia-media" })
  })

  it("strips a trailing slash from the public base URL", async () => {
    const settings = await resolveStorageSettings(fullEnvironment, repository(), decrypt)
    // Otherwise every stored URL gets a double slash, which some CDNs treat as a
    // different path and others normalise, so the same object gets two cache entries.
    expect(settings).toMatchObject({ publicBaseUrl: "https://media.example.com" })
  })

  it("uses local storage outside production when nothing is configured", async () => {
    const settings = await resolveStorageSettings({ APP_URL: "http://localhost:3000" }, repository(), decrypt, false)
    expect(settings).toMatchObject({ kind: "local", publicBaseUrl: "http://localhost:3000/generated" })
  })

  it("refuses local storage in production", async () => {
    // Writing generated media to the container filesystem in production means losing
    // it on the next deploy.
    await expect(resolveStorageSettings({}, repository(), decrypt, true)).rejects.toThrow(
      "R2_STORAGE_CONFIG_REQUIRED",
    )
  })

  it("rejects a partially configured environment instead of silently falling back", async () => {
    await expect(
      resolveStorageSettings({ R2_BUCKET: "partial" }, repository(), decrypt, false),
    ).rejects.toThrow("R2_STORAGE_CONFIG_REQUIRED")
  })

  it("treats an unreadable configuration row as absent rather than failing every upload", async () => {
    const broken: StorageSettingsRepository = {
      findActive: vi.fn(async () => {
        throw new Error("connection terminated")
      }),
    }
    const settings = await resolveStorageSettings(fullEnvironment, broken, decrypt)
    expect(settings).toMatchObject({ source: "environment" })
  })

  it("survives a repository that throws synchronously", async () => {
    // `getPrisma()` throws synchronously when DATABASE_URL is absent, so the promise is
    // never created and a `.catch()` on it never runs. This is the case that made the
    // admin settings page fail to render rather than reporting "not configured".
    const broken: StorageSettingsRepository = {
      findActive: () => {
        throw new Error("DATABASE_URL is required for database access")
      },
    }
    const settings = await resolveStorageSettings(fullEnvironment, broken, decrypt)
    expect(settings).toMatchObject({ source: "environment" })
  })
})

describe("createStorageProvider", () => {
  it("builds R2 from resolved settings", async () => {
    const provider = await createStorageProvider({
      kind: "r2",
      ...fullEnvironment,
      endpoint: fullEnvironment.R2_ENDPOINT,
      accessKeyId: "key",
      secretAccessKey: "secret",
      bucket: "b",
      publicBaseUrl: "https://p",
      source: "environment",
    })
    expect(provider.constructor.name).toBe("R2StorageProvider")
  })

  it("builds local storage from resolved settings", async () => {
    const provider = await createStorageProvider({
      kind: "local",
      root: "/tmp/generated",
      publicBaseUrl: "http://localhost:3000/generated",
      source: "default",
    })
    expect(provider.constructor.name).toBe("LocalStorageProvider")
  })
})

describe("normalizeEndpoint", () => {
  it("keeps only scheme and host, so a bucket pasted into the endpoint cannot prefix every key", async () => {
    const { normalizeEndpoint } = await import("./configuration")
    expect(normalizeEndpoint("https://acct.r2.cloudflarestorage.com/adcrevia-bucket/")).toBe("https://acct.r2.cloudflarestorage.com")
    expect(normalizeEndpoint("https://acct.r2.cloudflarestorage.com")).toBe("https://acct.r2.cloudflarestorage.com")
  })
})

describe("storage public URL validation", () => {
  it("rejects the private S3 API host as the public URL", async () => {
    const { storageConfigurationSchema } = await import("@/features/admin/storage/schemas")
    const base = { endpoint: "https://acct.r2.cloudflarestorage.com", accessKeyId: "AKIA12345678", secretAccessKey: "secret12345678", bucket: "adcrevia-bucket" }
    expect(storageConfigurationSchema.safeParse({ ...base, publicBaseUrl: "https://acct.r2.cloudflarestorage.com" }).success).toBe(false)
    expect(storageConfigurationSchema.safeParse({ ...base, publicBaseUrl: "https://pub-abc123.r2.dev" }).success).toBe(true)
  })
})
