import { getPrisma } from "@/lib/db/prisma"
import { describeEmail } from "@/lib/email/configuration"
import { describeStorage } from "@/lib/storage/configuration"

/**
 * Is each service actually usable, from EITHER place it can be configured?
 *
 * `productionEnvironmentStatus` only reads environment variables, so a host whose
 * keys were entered in the admin console (the intended production path) reported
 * "degraded" forever. This combines both sources, the same way the runtime resolves
 * them: a database row or the environment variable.
 *
 * Booleans only — nothing here reads or returns a credential.
 */

type Environment = Record<string, string | undefined>

export type ServiceReadiness = {
  ready: boolean
  services: {
    database: boolean
    authentication: boolean
    /** OpenAI key: always needed, it does the writing and the brief conversation. */
    openai: boolean
    /** At least one image provider (OpenAI, FLUX, Google). */
    image: boolean
    /** At least one video provider (Runway, FLUX video). */
    video: boolean
    storage: boolean
    email: boolean
  }
}

export type ReadinessRepository = {
  /** Provider rows that hold a credential, as `kind:slug`, enabled or not. */
  configuredProviders(): Promise<{ kind: string; slug: string; enabled: boolean }[]>
}

export async function resolveServiceReadiness(
  environment: Environment = process.env,
  database = false,
  repository: ReadinessRepository = prismaReadinessRepository,
  describe = { storage: describeStorage, email: describeEmail },
): Promise<ServiceReadiness> {
  let rows: { kind: string; slug: string; enabled: boolean }[] = []
  try {
    rows = await repository.configuredProviders()
  } catch {
    rows = []
  }
  const [storage, email] = await Promise.all([
    describe.storage().then((status) => status.configured).catch(() => false),
    describe.email().then((status) => status.configured).catch(() => false),
  ])

  const has = (key: string) => Boolean(environment[key]?.trim())
  const openaiRow = rows.some((row) => row.kind === "IMAGE" && (row.slug === "openai-image" || row.slug === "openai"))
  const enabledOf = (kind: string) => rows.some((row) => row.kind === kind && row.enabled)

  const services = {
    database,
    authentication: has("AUTH_SECRET") && has("ENCRYPTION_KEY"),
    openai: openaiRow || has("OPENAI_API_KEY"),
    image: enabledOf("IMAGE") || has("OPENAI_API_KEY") || has("BFL_API_KEY"),
    video: enabledOf("VIDEO") || has("RUNWAYML_API_SECRET") || has("BFL_API_KEY"),
    storage,
    email,
  }
  const core = has("DATABASE_URL") && has("APP_URL")
  return { ready: core && Object.values(services).every(Boolean), services }
}

const prismaReadinessRepository: ReadinessRepository = {
  async configuredProviders() {
    const rows = await getPrisma().aPIConfiguration.findMany({
      where: { provider: { kind: { in: ["IMAGE", "VIDEO"] } } },
      // Only checked for presence; never decrypted here.
      select: { enabled: true, encryptedCredential: true, provider: { select: { kind: true, slug: true } } },
    })
    return rows
      .filter((row) => Boolean(row.encryptedCredential))
      .map((row) => ({ kind: row.provider.kind, slug: row.provider.slug, enabled: row.enabled }))
  },
}
