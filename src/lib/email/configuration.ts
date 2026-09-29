import { getPrisma } from "@/lib/db/prisma"
import { decryptCredential, type EncryptedCredential } from "@/lib/encryption/provider-credentials"

/**
 * How outgoing email is sent.
 *
 * Resolution order is database, then environment — the same as storage and the
 * generation providers — so an administrator can connect or rotate a mailbox from
 * Admin → Email without a deploy, and a host configured only through environment
 * variables keeps working untouched.
 *
 * The secret (SMTP password or Resend API key) is encrypted in `encryptedCredential`.
 * Host, port, username and sender are not secret and live in `settings`, so the console
 * can show them without decrypting anything.
 */

export const EMAIL_SLUG = "email-delivery"

export type SmtpSettings = {
  transport: "smtp"
  host: string
  port: number
  username: string
  password: string
  from: string
  source: "database" | "environment"
}

export type ResendSettings = {
  transport: "resend"
  apiKey: string
  from: string
  source: "database" | "environment"
}

export type EmailSettings = SmtpSettings | ResendSettings

export type EmailPublicSettings = {
  transport: "smtp" | "resend"
  host: string
  port: number
  username: string
  fromName: string
  fromAddress: string
}

type Environment = Record<string, string | undefined>

export type EmailSettingsRepository = {
  findActive(): Promise<{ settings: unknown; encryptedCredential: unknown } | null>
}

/** Same reasoning as storage: `getPrisma()` can throw synchronously. */
async function readStored(repository: EmailSettingsRepository) {
  try {
    return await repository.findActive()
  } catch {
    return null
  }
}

/** Resolved settings, or null when no transport is configured anywhere. */
export async function resolveEmailSettings(
  environment: Environment = process.env,
  repository: EmailSettingsRepository = prismaEmailSettingsRepository,
  decrypt: (value: EncryptedCredential) => string = decryptCredential,
): Promise<EmailSettings | null> {
  const stored = await readStored(repository)
  if (stored?.encryptedCredential) {
    const settings = readPublicSettings(stored.settings)
    const secret = decrypt(stored.encryptedCredential as EncryptedCredential)
    // A half-written row must not silently fall through to the environment and send
    // from a different mailbox than the console shows.
    if (!settings || !secret || !settings.fromAddress) throw new Error("EMAIL_CONFIG_INCOMPLETE")
    const from = formatFrom(settings.fromName, settings.fromAddress)
    if (settings.transport === "resend") return { transport: "resend", apiKey: secret, from, source: "database" }
    if (!settings.host || !settings.username) throw new Error("EMAIL_CONFIG_INCOMPLETE")
    return {
      transport: "smtp",
      host: settings.host,
      port: settings.port,
      username: settings.username,
      password: secret,
      from,
      source: "database",
    }
  }

  const from = environment.EMAIL_FROM?.trim()
  if (!from) return null
  if (environment.SMTP_HOST?.trim() && environment.SMTP_USER?.trim() && environment.SMTP_PASSWORD) {
    return {
      transport: "smtp",
      host: environment.SMTP_HOST.trim(),
      port: Number(environment.SMTP_PORT || 465),
      username: environment.SMTP_USER.trim(),
      password: environment.SMTP_PASSWORD,
      from,
      source: "environment",
    }
  }
  if (environment.RESEND_API_KEY?.trim()) {
    return { transport: "resend", apiKey: environment.RESEND_API_KEY.trim(), from, source: "environment" }
  }
  return null
}

/** What the console may see: never the password or API key. */
export async function describeEmail(
  environment: Environment = process.env,
  repository: EmailSettingsRepository = prismaEmailSettingsRepository,
): Promise<{ configured: boolean; source: "database" | "environment" | "none"; settings: EmailPublicSettings | null }> {
  const stored = await readStored(repository)
  if (stored?.encryptedCredential) {
    const settings = readPublicSettings(stored.settings)
    return { configured: Boolean(settings?.fromAddress), source: "database", settings }
  }

  const from = parseFrom(environment.EMAIL_FROM ?? "")
  const smtp = Boolean(environment.SMTP_HOST?.trim() && environment.SMTP_USER?.trim() && environment.SMTP_PASSWORD)
  const resend = Boolean(environment.RESEND_API_KEY?.trim())
  if (from.address && (smtp || resend)) {
    return {
      configured: true,
      source: "environment",
      settings: {
        transport: smtp ? "smtp" : "resend",
        host: smtp ? environment.SMTP_HOST!.trim() : "",
        port: smtp ? Number(environment.SMTP_PORT || 465) : 465,
        username: smtp ? environment.SMTP_USER!.trim() : "",
        fromName: from.name,
        fromAddress: from.address,
      },
    }
  }
  return { configured: false, source: "none", settings: null }
}

export function formatFrom(name: string, address: string) {
  const cleanName = name.replace(/["<>\r\n]/g, "").trim()
  return cleanName ? `${cleanName} <${address}>` : address
}

/** "Adcrevia <admin@adcrevia.com>" or "admin@adcrevia.com" → parts. */
export function parseFrom(value: string): { name: string; address: string } {
  const match = value.trim().match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/)
  if (match) return { name: match[1].replace(/^"|"$/g, "").trim(), address: match[2] }
  return /^[^<>\s]+@[^<>\s]+$/.test(value.trim()) ? { name: "", address: value.trim() } : { name: "", address: "" }
}

function readPublicSettings(value: unknown): EmailPublicSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const transport = record.transport === "resend" ? "resend" : record.transport === "smtp" ? "smtp" : null
  if (!transport) return null
  const port = Number(record.port)
  return {
    transport,
    host: typeof record.host === "string" ? record.host : "",
    port: Number.isInteger(port) && port > 0 ? port : 465,
    username: typeof record.username === "string" ? record.username : "",
    fromName: typeof record.fromName === "string" ? record.fromName : "",
    fromAddress: typeof record.fromAddress === "string" ? record.fromAddress : "",
  }
}

const prismaEmailSettingsRepository: EmailSettingsRepository = {
  findActive() {
    return getPrisma().aPIConfiguration.findFirst({
      where: { enabled: true, provider: { kind: "EMAIL", slug: EMAIL_SLUG } },
      orderBy: { createdAt: "desc" },
      select: { settings: true, encryptedCredential: true },
    })
  },
}
