import { describe, expect, it } from "vitest"

import { resolveServiceReadiness, type ReadinessRepository } from "./readiness"

const base = { DATABASE_URL: "postgres://x", APP_URL: "https://adcrevia.com", AUTH_SECRET: "a", ENCRYPTION_KEY: "b" }
const rows = (list: { kind: string; slug: string; enabled: boolean }[]): ReadinessRepository => ({ configuredProviders: async () => list })
const configured = { storage: async () => ({ configured: true }), email: async () => ({ configured: true }) }
const unconfigured = { storage: async () => ({ configured: false }), email: async () => ({ configured: false }) }

describe("resolveServiceReadiness", () => {
  it("is ready when every service is configured in the admin console, with no provider env vars", async () => {
    const readiness = await resolveServiceReadiness(
      base,
      true,
      rows([
        { kind: "IMAGE", slug: "openai-image", enabled: true },
        { kind: "VIDEO", slug: "runway-video", enabled: true },
      ]),
      configured as never,
    )
    expect(readiness.ready).toBe(true)
  })

  it("is ready from the environment alone", async () => {
    const env = { ...base, OPENAI_API_KEY: "k", RUNWAYML_API_SECRET: "r" }
    const readiness = await resolveServiceReadiness(env, true, rows([]), configured as never)
    expect(readiness.services).toMatchObject({ openai: true, image: true, video: true })
    expect(readiness.ready).toBe(true)
  })

  it("reports each missing service, and is not ready without the database", async () => {
    const readiness = await resolveServiceReadiness(base, false, rows([]), unconfigured as never)
    expect(readiness.ready).toBe(false)
    expect(readiness.services).toEqual({
      database: false,
      authentication: true,
      openai: false,
      image: false,
      video: false,
      storage: false,
      email: false,
    })
  })

  it("does not count a disabled video provider as available", async () => {
    const readiness = await resolveServiceReadiness(
      { ...base, OPENAI_API_KEY: "k" },
      true,
      rows([{ kind: "VIDEO", slug: "runway-video", enabled: false }]),
      configured as never,
    )
    expect(readiness.services.video).toBe(false)
  })

  it("treats an unreadable provider table as nothing configured", async () => {
    const broken: ReadinessRepository = {
      configuredProviders: async () => {
        throw new Error("down")
      },
    }
    const readiness = await resolveServiceReadiness({ ...base, OPENAI_API_KEY: "k" }, true, broken, configured as never)
    expect(readiness.services).toMatchObject({ openai: true, image: true, video: false })
  })
})
