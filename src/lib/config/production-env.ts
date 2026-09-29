import { smtpConfigured } from "@/lib/email/deliver"

const requiredVariables = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "ENCRYPTION_KEY",
  "APP_URL",
  "OPENAI_API_KEY",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "RUNWAYML_API_SECRET",
  "EMAIL_FROM",
] as const

// Email needs one transport: SMTP (see src/lib/email/deliver.ts) or Resend.
const emailTransportRequirement = "RESEND_API_KEY or SMTP_HOST+SMTP_USER+SMTP_PASSWORD"

type Environment = Record<string, string | undefined>

export function productionEnvironmentStatus(environment: Environment) {
  const emailTransport = Boolean(environment.RESEND_API_KEY?.trim()) || smtpConfigured(environment)
  const missing: string[] = requiredVariables.filter((key) => !environment[key]?.trim())
  if (!emailTransport) missing.push(emailTransportRequirement)
  return {
    ready: missing.length === 0,
    missing,
    services: {
      database: Boolean(environment.DATABASE_URL),
      authentication: Boolean(environment.AUTH_SECRET && environment.ENCRYPTION_KEY),
      openai: Boolean(environment.OPENAI_API_KEY),
      storage: Boolean(environment.R2_ENDPOINT && environment.R2_ACCESS_KEY_ID && environment.R2_SECRET_ACCESS_KEY && environment.R2_BUCKET && environment.R2_PUBLIC_BASE_URL),
      runway: Boolean(environment.RUNWAYML_API_SECRET),
      email: Boolean(emailTransport && environment.EMAIL_FROM),
    },
  }
}

export function assertProductionEnvironment(environment: Environment = process.env) {
  const status = productionEnvironmentStatus(environment)
  if (!status.ready) throw new Error(`Missing required production variables: ${status.missing.join(", ")}`)
  return status
}
