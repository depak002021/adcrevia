import { resolveTextModels, TEXT_MODEL_SETTING_KEYS, type TextModelRole, type TextModelSource } from "@/lib/ai/text-models"
import { getPrisma } from "@/lib/db/prisma"
import { describeDecisionBackend, TYPESAFE_DECISION_SLUG } from "@/lib/decisions/runtime"
import { encryptCredential } from "@/lib/encryption/provider-credentials"
import { HttpError } from "@/lib/http/http-error"

import { textModelsSchema, typeSafeConfigurationSchema } from "./schemas"

/**
 * Admin → AI text: which OpenAI models write, converse and classify, and the optional
 * TypeSafe Jev credential for the decision layer.
 *
 * Models are plain system settings (not secret). The TypeSafe key is an encrypted
 * provider row under the slug the decision runtime already reads, so saving it here
 * switches the decision layer over without a deploy — exactly the resolution order
 * documented in src/lib/decisions/runtime.ts. Like storage, a save writes a new row and
 * disables the previous one, so there is a record of what was configured and when.
 */

type AdminActor = { id: string; role: "USER" | "SUPER_ADMIN" }

export type AiTextStatus = {
  /** What each role resolves to right now, and where that came from. */
  models: Record<TextModelRole, { value: string; source: TextModelSource }>
  /** Only what is saved in the console; blank means the environment/default applies. */
  saved: Record<TextModelRole, string>
  decisions: { provider: "openai" | "typesafe"; source: "database" | "environment" | "none"; configured: boolean }
  typesafe: { configured: boolean; model: string; endpoint: string; savedAt: Date | null }
}

export async function readAiTextStatus(): Promise<AiTextStatus> {
  const db = getPrisma()
  const [resolved, rows, decisions, typesafe] = await Promise.all([
    resolveTextModels(),
    db.systemSetting.findMany({ where: { key: { in: Object.values(TEXT_MODEL_SETTING_KEYS) } } }),
    describeDecisionBackend(),
    db.aPIConfiguration.findFirst({
      where: { enabled: true, provider: { kind: "TEXT", slug: TYPESAFE_DECISION_SLUG } },
      orderBy: { createdAt: "desc" },
      select: { model: true, endpoint: true, createdAt: true },
    }),
  ])
  const saved = Object.fromEntries(rows.map((row) => [row.key, typeof row.value === "string" ? row.value : ""]))
  const roles = Object.keys(TEXT_MODEL_SETTING_KEYS) as TextModelRole[]

  return {
    models: Object.fromEntries(roles.map((role) => [role, { value: resolved[role], source: resolved.source[role] }])) as AiTextStatus["models"],
    saved: Object.fromEntries(roles.map((role) => [role, saved[TEXT_MODEL_SETTING_KEYS[role]] ?? ""])) as AiTextStatus["saved"],
    decisions,
    typesafe: {
      configured: Boolean(typesafe),
      model: typesafe?.model ?? "",
      endpoint: typesafe?.endpoint ?? "",
      savedAt: typesafe?.createdAt ?? null,
    },
  }
}

export async function saveTextModels(raw: unknown, admin: AdminActor): Promise<AiTextStatus> {
  assertSuperAdmin(admin)
  const input = textModelsSchema.parse(raw ?? {})
  const db = getPrisma()

  await db.$transaction(
    (Object.keys(TEXT_MODEL_SETTING_KEYS) as TextModelRole[]).map((role) => {
      const key = TEXT_MODEL_SETTING_KEYS[role]
      const value = input[role]
      // Blank removes the console value so the environment/default applies again,
      // rather than storing an empty string that would have to be special-cased.
      return value
        ? db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
        : db.systemSetting.deleteMany({ where: { key } })
    }),
  )
  return readAiTextStatus()
}

export async function saveTypeSafeConfiguration(raw: unknown, admin: AdminActor): Promise<AiTextStatus> {
  assertSuperAdmin(admin)
  const input = typeSafeConfigurationSchema.parse(raw)
  const db = getPrisma()

  await db.$transaction(async (transaction) => {
    const provider = await transaction.aIProvider.upsert({
      where: { slug: TYPESAFE_DECISION_SLUG },
      create: { slug: TYPESAFE_DECISION_SLUG, name: "TypeSafe Jev", kind: "TEXT" },
      update: { enabled: true },
    })
    await transaction.aPIConfiguration.updateMany({
      where: { providerId: provider.id, enabled: true },
      data: { enabled: false },
    })
    await transaction.aPIConfiguration.create({
      data: {
        providerId: provider.id,
        name: "TypeSafe Jev",
        model: input.model || null,
        endpoint: input.endpoint || null,
        encryptedCredential: encryptCredential(input.apiKey),
        enabled: true,
      },
    })
  })
  return readAiTextStatus()
}

/** Stop using the saved TypeSafe key; the decision layer falls back to OpenAI. */
export async function disableTypeSafeConfiguration(admin: AdminActor): Promise<AiTextStatus> {
  assertSuperAdmin(admin)
  await getPrisma().aPIConfiguration.updateMany({
    where: { enabled: true, provider: { kind: "TEXT", slug: { in: [TYPESAFE_DECISION_SLUG, "typesafe"] } } },
    data: { enabled: false },
  })
  return readAiTextStatus()
}

function assertSuperAdmin(admin: AdminActor) {
  if (admin.role !== "SUPER_ADMIN") throw new HttpError(403, "Forbidden")
}
