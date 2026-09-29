import { getPrisma } from "@/lib/db/prisma"
import { describeEmail, EMAIL_SLUG, formatFrom, resolveEmailSettings, type EmailSettings } from "@/lib/email/configuration"
import { sendWithSettings, verifySmtp } from "@/lib/email/deliver"
import { encryptCredential } from "@/lib/encryption/provider-credentials"
import { HttpError } from "@/lib/http/http-error"

import { emailConfigurationSchema, type EmailConfigurationInput } from "./schemas"

/**
 * Connecting a mailbox from the console (Admin → Email).
 *
 * Mirrors storage: the secret is encrypted at rest and never sent back to a browser,
 * a save writes a new row and disables the previous one (a record of what was
 * configured and when), and the environment stays as the fallback.
 */

type AdminActor = { id: string; role: "USER" | "SUPER_ADMIN"; email?: string | null }

export type EmailStatus = {
  configured: boolean
  source: "database" | "environment" | "none"
  transport: "smtp" | "resend"
  host: string
  port: number
  username: string
  fromName: string
  fromAddress: string
  lastTestedAt: Date | null
  lastTestSucceeded: boolean | null
  safeTestMessage: string | null
}

export async function readEmailStatus(): Promise<EmailStatus> {
  const [described, row] = await Promise.all([
    describeEmail(),
    getPrisma().aPIConfiguration.findFirst({
      where: { enabled: true, provider: { kind: "EMAIL", slug: EMAIL_SLUG } },
      orderBy: { createdAt: "desc" },
      select: { lastTestedAt: true, lastTestSucceeded: true, safeTestMessage: true },
    }),
  ])
  const settings = described.settings
  return {
    configured: described.configured,
    source: described.source,
    transport: settings?.transport ?? "smtp",
    host: settings?.host ?? "",
    port: settings?.port ?? 465,
    username: settings?.username ?? "",
    fromName: settings?.fromName ?? "",
    fromAddress: settings?.fromAddress ?? "",
    lastTestedAt: row?.lastTestedAt ?? null,
    lastTestSucceeded: row?.lastTestSucceeded ?? null,
    safeTestMessage: row?.safeTestMessage ?? null,
  }
}

export async function saveEmailConfiguration(raw: unknown, admin: AdminActor): Promise<EmailStatus> {
  assertSuperAdmin(admin)
  const input = emailConfigurationSchema.parse(raw)
  const db = getPrisma()

  await db.$transaction(async (transaction) => {
    const provider = await transaction.aIProvider.upsert({
      where: { slug: EMAIL_SLUG },
      create: { slug: EMAIL_SLUG, name: "Email delivery", kind: "EMAIL" },
      update: { enabled: true },
    })
    // Exactly one active configuration, so which mailbox sends never depends on row order.
    await transaction.aPIConfiguration.updateMany({
      where: { providerId: provider.id, enabled: true },
      data: { enabled: false },
    })
    await transaction.aPIConfiguration.create({
      data: {
        providerId: provider.id,
        name: input.transport === "smtp" ? `SMTP ${input.username}` : `Resend ${input.fromAddress}`,
        encryptedCredential: encryptCredential(input.transport === "smtp" ? input.password : input.apiKey),
        settings: {
          transport: input.transport,
          host: input.transport === "smtp" ? input.host : "",
          port: input.transport === "smtp" ? input.port : 465,
          username: input.transport === "smtp" ? input.username : "",
          fromName: input.fromName,
          fromAddress: input.fromAddress,
        },
        enabled: true,
      },
    })
  })
  return readEmailStatus()
}

/**
 * Prove delivery works by sending a real message to the signed-in administrator.
 *
 * SMTP logs in first (verify) so a wrong password is reported as such rather than as a
 * generic send failure. A complete form is tested as entered, before saving; anything
 * less tests what is already saved — the useful case after a password change elsewhere.
 */
export async function testEmailConfiguration(raw: unknown, admin: AdminActor): Promise<EmailStatus> {
  assertSuperAdmin(admin)
  if (!admin.email) throw new HttpError(400, "Your account has no email address to send the test to.")

  const parsed = emailConfigurationSchema.safeParse(raw)
  const testingSaved = !parsed.success

  let ok = false
  let safeTestMessage = `Test email sent to ${admin.email}.`
  try {
    const settings = parsed.success ? fromInput(parsed.data) : await resolveEmailSettings()
    if (!settings) throw new Error("EMAIL_NOT_CONFIGURED")
    if (settings.transport === "smtp") await verifySmtp(settings)
    await sendWithSettings(settings, {
      to: admin.email,
      subject: "Adcrevia email test",
      text: "This is a test from Admin → Email. Delivery is working.",
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#17151f">
        <p style="color:#7357ff;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Adcrevia</p>
        <h1 style="font-size:24px">Email delivery is working</h1>
        <p>This is a test sent from Admin &rarr; Email.</p></div>`,
    })
    ok = true
  } catch (error) {
    // A category, never the server's own text: SMTP errors can echo the login name,
    // the host's software banner and occasionally part of the exchange.
    safeTestMessage = categoriseEmailError(error)
  }

  if (testingSaved) {
    await getPrisma()
      .aPIConfiguration.updateMany({
        where: { enabled: true, provider: { kind: "EMAIL", slug: EMAIL_SLUG } },
        data: { lastTestedAt: new Date(), lastTestSucceeded: ok, safeTestMessage },
      })
      .catch(() => {})
  }

  const status = await readEmailStatus()
  return { ...status, lastTestedAt: new Date(), lastTestSucceeded: ok, safeTestMessage }
}

function fromInput(input: EmailConfigurationInput): EmailSettings {
  const from = formatFrom(input.fromName, input.fromAddress)
  if (input.transport === "resend") return { transport: "resend", apiKey: input.apiKey, from, source: "database" }
  return {
    transport: "smtp",
    host: input.host,
    port: input.port,
    username: input.username,
    password: input.password,
    from,
    source: "database",
  }
}

function categoriseEmailError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : ""
  const message = error instanceof Error ? error.message : ""
  if (message === "EMAIL_NOT_CONFIGURED") return "Nothing is configured yet."
  if (message === "EMAIL_CONFIG_INCOMPLETE") return "The saved configuration is incomplete."
  if (code === "EAUTH") return "The mail server rejected the login. Check the username and password."
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET" || code === "EDNS") {
    return "The mail server could not be reached. Check the host and port."
  }
  if (code === "EENVELOPE" || code === "EMESSAGE") return "The mail server refused the message. Check the sender address."
  if (code === "ETLS") return "A secure connection could not be established. Try port 465."
  return "The test email could not be sent."
}

function assertSuperAdmin(admin: AdminActor) {
  if (admin.role !== "SUPER_ADMIN") throw new HttpError(403, "Forbidden")
}
