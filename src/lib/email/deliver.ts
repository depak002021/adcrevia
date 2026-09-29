import nodemailer from "nodemailer"
import { Resend } from "resend"

import { resolveEmailSettings, type EmailSettings } from "./configuration"

export type OutgoingEmail = { to: string; subject: string; html: string; text: string }

type Environment = Record<string, string | undefined>

/**
 * True when the ENVIRONMENT alone configures SMTP. Only the environment-level
 * readiness check uses this; delivery itself goes through `resolveEmailSettings`,
 * which also honours a mailbox configured in Admin → Email.
 */
export function smtpConfigured(environment: Environment = process.env) {
  return Boolean(environment.SMTP_HOST?.trim() && environment.SMTP_USER?.trim() && environment.SMTP_PASSWORD)
}

/**
 * Send one email with whatever transport is configured (Admin → Email first, then the
 * environment). The From must be the mailbox's own address: a From on another domain
 * fails SPF/DKIM and recipients silently drop the mail.
 */
export async function deliverEmail(email: OutgoingEmail) {
  const settings = await resolveEmailSettings()
  if (!settings) throw new Error("Email delivery is not configured")
  await sendWithSettings(settings, email)
}

export async function sendWithSettings(settings: EmailSettings, email: OutgoingEmail) {
  if (settings.transport === "smtp") {
    await smtpTransport(settings).sendMail({ from: settings.from, ...email })
    return
  }
  const { error } = await new Resend(settings.apiKey).emails.send({ from: settings.from, ...email })
  if (error) throw new Error(error.message)
}

/** Log in to the SMTP server without sending anything. */
export async function verifySmtp(settings: Extract<EmailSettings, { transport: "smtp" }>) {
  await smtpTransport(settings).verify()
}

function smtpTransport(settings: Extract<EmailSettings, { transport: "smtp" }>) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 is implicit TLS; any other port (587) upgrades with STARTTLS, which is required.
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.username, pass: settings.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  })
}
