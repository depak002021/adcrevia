import { describe, expect, it } from "vitest"

import { describeEmail, parseFrom, resolveEmailSettings, type EmailSettingsRepository } from "./configuration"

const nothingStored: EmailSettingsRepository = { findActive: async () => null }
const stored = (settings: unknown): EmailSettingsRepository => ({
  findActive: async () => ({ settings, encryptedCredential: { ciphertext: "x" } }),
})
const decrypt = () => "mailbox-secret"

const smtpRow = {
  transport: "smtp",
  host: "mail.example.com",
  port: 465,
  username: "admin@example.com",
  fromName: "Adcrevia",
  fromAddress: "admin@example.com",
}

describe("resolveEmailSettings", () => {
  it("uses the console mailbox first, even when the environment is also set", async () => {
    const settings = await resolveEmailSettings(
      { SMTP_HOST: "env.example.com", SMTP_USER: "env", SMTP_PASSWORD: "env", EMAIL_FROM: "env@example.com" },
      stored(smtpRow),
      decrypt,
    )
    expect(settings).toEqual({
      transport: "smtp",
      host: "mail.example.com",
      port: 465,
      username: "admin@example.com",
      password: "mailbox-secret",
      from: "Adcrevia <admin@example.com>",
      source: "database",
    })
  })

  it("supports a Resend key saved in the console", async () => {
    const settings = await resolveEmailSettings({}, stored({ ...smtpRow, transport: "resend", host: "" }), decrypt)
    expect(settings).toMatchObject({ transport: "resend", apiKey: "mailbox-secret", source: "database" })
  })

  it("refuses a half-written row instead of silently using the environment", async () => {
    await expect(
      resolveEmailSettings({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.co" }, stored({ ...smtpRow, fromAddress: "" }), decrypt),
    ).rejects.toThrow("EMAIL_CONFIG_INCOMPLETE")
  })

  it("falls back to SMTP, then Resend, from the environment", async () => {
    await expect(
      resolveEmailSettings({ SMTP_HOST: "h.example.com", SMTP_USER: "u", SMTP_PASSWORD: "p", SMTP_PORT: "587", EMAIL_FROM: "a@b.co" }, nothingStored, decrypt),
    ).resolves.toMatchObject({ transport: "smtp", port: 587, source: "environment" })
    await expect(
      resolveEmailSettings({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.co" }, nothingStored, decrypt),
    ).resolves.toMatchObject({ transport: "resend", source: "environment" })
    await expect(resolveEmailSettings({}, nothingStored, decrypt)).resolves.toBeNull()
  })

  it("treats an unreadable database as nothing stored", async () => {
    const broken: EmailSettingsRepository = {
      findActive: () => {
        throw new Error("DATABASE_URL is required")
      },
    }
    await expect(resolveEmailSettings({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.co" }, broken, decrypt)).resolves.toMatchObject({
      source: "environment",
    })
  })
})

describe("describeEmail", () => {
  it("never includes the secret", async () => {
    const env = { SMTP_HOST: "h.example.com", SMTP_USER: "u@example.com", SMTP_PASSWORD: "top-secret", EMAIL_FROM: "Ad <u@example.com>" }
    const described = await describeEmail(env, nothingStored)
    expect(described).toMatchObject({ configured: true, source: "environment", settings: { fromName: "Ad", fromAddress: "u@example.com" } })
    expect(JSON.stringify(described)).not.toContain("top-secret")
  })
})

describe("parseFrom", () => {
  it("splits a display name from the address", () => {
    expect(parseFrom("Adcrevia <admin@adcrevia.com>")).toEqual({ name: "Adcrevia", address: "admin@adcrevia.com" })
    expect(parseFrom("admin@adcrevia.com")).toEqual({ name: "", address: "admin@adcrevia.com" })
    expect(parseFrom("not an address")).toEqual({ name: "", address: "" })
  })
})
