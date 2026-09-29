import { resolveTextModels } from "@/lib/ai/text-models"
import { getPrisma } from "@/lib/db/prisma"
import { decryptCredential, type EncryptedCredential } from "@/lib/encryption/provider-credentials"
import { resolveOpenAITextSettings } from "@/lib/providers/configuration"

import { OpenAIDecisionProvider } from "./openai-provider"
import { TypeSafeDecisionProvider } from "./typesafe-provider"
import { DecisionError, type DecisionProvider } from "./types"

/**
 * Which decision backend answers.
 *
 * Resolution order, strongest signal first:
 *   1. `DECISION_PROVIDER` — an explicit operator override, so a backend can be
 *      pinned or a suspect one taken out of the path without touching the
 *      database.
 *   2. An enabled TEXT provider row for TypeSafe in the admin console. This is
 *      the intended production path: the credential is encrypted at rest and an
 *      administrator switches backends without a deploy.
 *   3. `TYPESAFE_API_KEY` from the environment, for a host configured before the
 *      admin console has been used.
 *   4. OpenAI, which reuses the key the product already needs.
 *
 * Deliberately not cached. Resolution is one indexed read, the same cost the
 * image and video providers already pay per call, and caching it would mean an
 * administrator disabling a backend does not take effect until a restart — which
 * is exactly the moment they most need it to.
 */

/** Slug Admin → AI text saves the Jev credential under. */
export const TYPESAFE_DECISION_SLUG = "typesafe-decision"

/** Slugs an administrator may have used for the Jev credential. */
const TYPESAFE_SLUGS = [TYPESAFE_DECISION_SLUG, "typesafe"]

type Environment = Record<string, string | undefined>

export type DecisionProviderChoice = "openai" | "typesafe"

export type ResolvedDecisionBackend = {
  provider: DecisionProvider
  /** Where the credential came from, for the admin console's status view. */
  source: "database" | "environment"
}

export async function resolveDecisionProvider(
  environment: Environment = process.env,
  repository: DecisionSettingsRepository = prismaDecisionSettingsRepository,
): Promise<ResolvedDecisionBackend> {
  const override = normalizeChoice(environment.DECISION_PROVIDER)

  if (override === "openai") return { provider: await openAIBackend(environment), source: "environment" }

  const stored = await repository.findTypeSafeConfiguration()
  if (stored) {
    return {
      provider: new TypeSafeDecisionProvider({
        apiKey: stored.apiKey,
        model: stored.model ?? environment.TYPESAFE_DECISION_MODEL,
        endpoint: stored.endpoint ?? environment.TYPESAFE_DECISION_ENDPOINT,
      }),
      source: "database",
    }
  }

  const envKey = environment.TYPESAFE_API_KEY ?? environment.JEV_API_KEY
  if (envKey) {
    return {
      provider: new TypeSafeDecisionProvider({
        apiKey: envKey,
        model: environment.TYPESAFE_DECISION_MODEL,
        endpoint: environment.TYPESAFE_DECISION_ENDPOINT,
      }),
      source: "environment",
    }
  }

  // An explicit `typesafe` override with no credential anywhere is a
  // misconfiguration, and silently answering with OpenAI would hide it.
  if (override === "typesafe") {
    throw new DecisionError("DECISION_PROVIDER_NOT_CONFIGURED", "DECISION_PROVIDER=typesafe without a key")
  }

  return { provider: await openAIBackend(environment), source: "environment" }
}

/**
 * Report which backend is active without building it or touching a credential.
 * For the admin console, which must never receive key material.
 */
export async function describeDecisionBackend(
  environment: Environment = process.env,
  repository: DecisionSettingsRepository = prismaDecisionSettingsRepository,
): Promise<{ provider: DecisionProviderChoice; source: "database" | "environment" | "none"; configured: boolean }> {
  const override = normalizeChoice(environment.DECISION_PROVIDER)
  if (override === "openai") {
    return { provider: "openai", source: "environment", configured: Boolean(environment.OPENAI_API_KEY) }
  }

  /**
   * A status page must never fail to render.
   *
   * `try`/`catch` rather than `.catch()` on the promise: `getPrisma()` throws
   * SYNCHRONOUSLY when `DATABASE_URL` is absent, so the promise is never created and a
   * `.catch()` never runs. `resolveDecisionProvider` deliberately does NOT do this — a
   * decision that cannot determine which backend should answer must fail loudly and be
   * retried, not quietly switch backends.
   */
  let stored = false
  try {
    stored = await repository.hasTypeSafeConfiguration()
  } catch {
    stored = false
  }

  if (stored) {
    return { provider: "typesafe", source: "database", configured: true }
  }
  if (environment.TYPESAFE_API_KEY ?? environment.JEV_API_KEY) {
    return { provider: "typesafe", source: "environment", configured: true }
  }
  if (override === "typesafe") return { provider: "typesafe", source: "none", configured: false }
  return { provider: "openai", source: "environment", configured: Boolean(environment.OPENAI_API_KEY) }
}

async function openAIBackend(environment: Environment): Promise<DecisionProvider> {
  // Reuses whichever OpenAI credential the product already resolved, so the
  // decision layer never needs its own key.
  const [settings, models] = await Promise.all([resolveOpenAITextSettings(environment), resolveTextModels(environment)])
  return new OpenAIDecisionProvider({
    apiKey: settings.apiKey,
    // A classifier wants the cheapest model that is still calibrated, which is
    // not necessarily the one used for creative writing. Admin → AI text, then
    // OPENAI_DECISION_MODEL, then the text model.
    model: models.decision,
  })
}

function normalizeChoice(value: string | undefined): DecisionProviderChoice | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "openai") return "openai"
  if (normalized === "typesafe" || normalized === "jev") return "typesafe"
  return null
}

export type DecisionSettingsRepository = {
  findTypeSafeConfiguration(): Promise<{ apiKey: string; model: string | null; endpoint: string | null } | null>
  hasTypeSafeConfiguration(): Promise<boolean>
}

const prismaDecisionSettingsRepository: DecisionSettingsRepository = {
  async findTypeSafeConfiguration() {
    const configuration = await getPrisma().aPIConfiguration.findFirst({
      where: { enabled: true, provider: { kind: "TEXT", slug: { in: TYPESAFE_SLUGS } } },
      orderBy: { createdAt: "desc" },
      select: { model: true, endpoint: true, encryptedCredential: true },
    })
    if (!configuration?.encryptedCredential) return null
    return {
      apiKey: decryptCredential(configuration.encryptedCredential as unknown as EncryptedCredential),
      model: configuration.model,
      endpoint: configuration.endpoint,
    }
  },
  async hasTypeSafeConfiguration() {
    const count = await getPrisma().aPIConfiguration.count({
      where: { enabled: true, provider: { kind: "TEXT", slug: { in: TYPESAFE_SLUGS } } },
    })
    return count > 0
  },
}
