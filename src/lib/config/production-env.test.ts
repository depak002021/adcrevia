import { describe, expect, it } from "vitest"

import { productionEnvironmentStatus } from "./production-env"

describe("productionEnvironmentStatus", () => {
  it("reports missing variables by service without exposing values", () => {
    const status = productionEnvironmentStatus({ DATABASE_URL: "postgres://configured", OPENAI_API_KEY: "secret" })
    expect(status.ready).toBe(false)
    expect(status.services.database).toBe(true)
    expect(status.services.openai).toBe(true)
    expect(status.missing).toContain("AUTH_SECRET")
    expect(JSON.stringify(status)).not.toContain("postgres://configured")
    expect(JSON.stringify(status)).not.toContain("secret")
  })

  it("is ready when every required production variable is present", () => {
    const values = Object.fromEntries([
      "DATABASE_URL", "AUTH_SECRET", "ENCRYPTION_KEY", "APP_URL", "OPENAI_API_KEY",
      "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL",
      "RUNWAYML_API_SECRET", "RESEND_API_KEY", "EMAIL_FROM",
    ].map((key) => [key, "configured"]))
    expect(productionEnvironmentStatus(values)).toMatchObject({ ready: true, missing: [] })
  })

  it("accepts SMTP in place of Resend as the email transport", () => {
    const base = Object.fromEntries([
      "DATABASE_URL", "AUTH_SECRET", "ENCRYPTION_KEY", "APP_URL", "OPENAI_API_KEY",
      "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL",
      "RUNWAYML_API_SECRET", "EMAIL_FROM",
    ].map((key) => [key, "configured"]))

    const withoutTransport = productionEnvironmentStatus(base)
    expect(withoutTransport.ready).toBe(false)
    expect(withoutTransport.services.email).toBe(false)

    const smtp = { SMTP_HOST: "mail.example.com", SMTP_USER: "admin@example.com", SMTP_PASSWORD: "smtp-secret" }
    const status = productionEnvironmentStatus({ ...base, ...smtp })
    expect(status).toMatchObject({ ready: true, missing: [] })
    expect(status.services.email).toBe(true)
    expect(JSON.stringify(status)).not.toContain("smtp-secret")
  })
})
