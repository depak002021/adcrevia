import { Prisma } from "@/generated/prisma/client"
import { getPrisma } from "@/lib/db/prisma"
import { HttpError } from "@/lib/http/http-error"
import { validateTemplate } from "@/lib/prompts/templates"

import { findPromptEntry, PROMPT_CATALOG } from "./catalog"
import { promptVersionSchema } from "./schemas"

/**
 * Editing the model's instructions without a deploy.
 *
 * Templates are versioned and immutable once written: saving an edit creates a new
 * version rather than changing the old one. That is what makes a bad change a rollback
 * instead of a recovery — and it is what lets `AgentRun.promptTemplateId` mean something,
 * since an output can still be traced to the exact wording that produced it after
 * somebody has edited it twice.
 *
 * At most one version per key may be active. The database enforces it with a partial
 * unique index; this code also serialises activation with an advisory lock, because the
 * index would otherwise turn two administrators pressing Activate at the same moment
 * into a constraint violation rather than a last-writer-wins.
 */

type AdminActor = { id: string; role: "USER" | "SUPER_ADMIN" }

/**
 * Advisory lock key for activation.
 *
 * A constant: activation is rare and global, so serialising all of it is simpler than a
 * per-key hash and costs nothing.
 */
const ACTIVATION_LOCK = 8_474_201

export type PromptVersionDto = {
  id: string
  key: string
  version: number
  label: string
  body: string
  variables: string[]
  model: string | null
  temperature: number | null
  active: boolean
  notes: string | null
  createdAt: Date
  createdBy: { name: string | null; email: string } | null
}

export type PromptKeyDto = {
  key: string
  label: string
  description: string
  variables: string[]
  /** The wording compiled into the application, shown when nothing is active. */
  fallback: string
  /** Which version is live, or null when the built-in default is. */
  activeVersion: number | null
  versionCount: number
}

export async function listPromptKeys(): Promise<PromptKeyDto[]> {
  const rows = await getPrisma().promptTemplate.findMany({
    where: { key: { in: PROMPT_CATALOG.map((entry) => entry.key) } },
    select: { key: true, version: true, active: true },
  })

  return PROMPT_CATALOG.map((entry) => {
    const versions = rows.filter((row) => row.key === entry.key)
    return {
      key: entry.key,
      label: entry.label,
      description: entry.description,
      variables: entry.variables,
      fallback: entry.fallback,
      activeVersion: versions.find((row) => row.active)?.version ?? null,
      versionCount: versions.length,
    }
  })
}

export async function listPromptVersions(key: string): Promise<PromptVersionDto[]> {
  if (!findPromptEntry(key)) throw new HttpError(404, "Unknown prompt")

  const rows = await getPrisma().promptTemplate.findMany({
    where: { key },
    orderBy: { version: "desc" },
    select: {
      id: true,
      key: true,
      version: true,
      label: true,
      body: true,
      variables: true,
      model: true,
      temperature: true,
      active: true,
      notes: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
    },
  })

  return rows.map((row) => ({ ...row, variables: asStringArray(row.variables) }))
}

/**
 * Save an edit as a new version.
 *
 * The version number is `max + 1` inside a transaction, retried on the unique index.
 * Two administrators saving at once is rare and self-resolving; a hand-written lock for
 * it would be more code and less verifiable.
 */
export async function createPromptVersion(
  key: string,
  raw: unknown,
  admin: AdminActor,
): Promise<PromptVersionDto> {
  assertSuperAdmin(admin)

  const entry = findPromptEntry(key)
  if (!entry) throw new HttpError(404, "Unknown prompt")

  const input = promptVersionSchema.parse(raw)

  // Both directions. A body referencing an undeclared variable would fail at render
  // time in front of a user; a declared variable the body never uses means the wording
  // was edited and the declaration was not.
  const validation = validateTemplate(input.body, entry.variables)
  if (!validation.ok) throw new HttpError(400, validation.reason)

  const db = getPrisma()

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const latest = await db.promptTemplate.findFirst({
      where: { key },
      orderBy: { version: "desc" },
      select: { version: true },
    })

    try {
      const created = await db.$transaction(async (transaction) => {
        if (input.activate) {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${ACTIVATION_LOCK} AS BIGINT))`
          await transaction.promptTemplate.updateMany({ where: { key, active: true }, data: { active: false } })
        }
        return transaction.promptTemplate.create({
          data: {
            key,
            version: (latest?.version ?? 0) + 1,
            label: input.label,
            body: input.body,
            variables: entry.variables,
            model: input.model ?? null,
            temperature: input.temperature ?? null,
            active: input.activate,
            notes: input.notes ?? null,
            createdById: admin.id,
          },
          select: promptSelect,
        })
      })
      return { ...created, variables: asStringArray(created.variables) }
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 5) throw error
    }
  }

  throw new HttpError(409, "Could not save that version. Try again.")
}

/** Make one version live, replacing whichever was. */
export async function activatePromptVersion(id: string, admin: AdminActor): Promise<PromptVersionDto> {
  assertSuperAdmin(admin)
  const db = getPrisma()

  const target = await db.promptTemplate.findUnique({ where: { id }, select: { id: true, key: true } })
  if (!target) throw new HttpError(404, "Unknown version")

  const updated = await db.$transaction(async (transaction) => {
    // Serialised, because the partial unique index would turn a race into a constraint
    // violation rather than a last-writer-wins.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${ACTIVATION_LOCK} AS BIGINT))`
    await transaction.promptTemplate.updateMany({
      where: { key: target.key, active: true },
      data: { active: false },
    })
    return transaction.promptTemplate.update({
      where: { id },
      data: { active: true },
      select: promptSelect,
    })
  })

  return { ...updated, variables: asStringArray(updated.variables) }
}

/**
 * Fall back to the wording in the code.
 *
 * Deactivating rather than deleting: the version stays in the history, and any run that
 * recorded it can still be traced. This is the rollback path when a new template turns
 * out to be worse than the built-in default.
 */
export async function deactivatePrompt(key: string, admin: AdminActor): Promise<{ key: string }> {
  assertSuperAdmin(admin)
  if (!findPromptEntry(key)) throw new HttpError(404, "Unknown prompt")

  await getPrisma().promptTemplate.updateMany({ where: { key, active: true }, data: { active: false } })
  return { key }
}

const promptSelect = {
  id: true,
  key: true,
  version: true,
  label: true,
  body: true,
  variables: true,
  model: true,
  temperature: true,
  active: true,
  notes: true,
  createdAt: true,
  createdBy: { select: { name: true, email: true } },
} as const

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function assertSuperAdmin(admin: AdminActor) {
  if (admin.role !== "SUPER_ADMIN") throw new HttpError(403, "Forbidden")
}
