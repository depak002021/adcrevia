import { getPrisma } from "@/lib/db/prisma"

/**
 * Prompt resolution.
 *
 * Every instruction to a model used to be a string literal in the codebase, so
 * tuning tone or a rubric meant a deploy, and nothing recorded which wording
 * produced a given output. A template is looked up by key, and the id of the
 * version that answered is stored on the run — so an output can be reproduced
 * after somebody edits the wording.
 *
 * Built-in defaults stay in the code and are returned when no active template
 * exists. That is deliberate: a fresh database, or one where an administrator has
 * disabled every version of a key, must still be able to hold a conversation.
 */

export type ResolvedPrompt = {
  /** Null when the built-in default answered, so the run records that honestly. */
  templateId: string | null
  version: number | null
  body: string
  model: string | null
  temperature: number | null
  /** Variable names the template declared. Used to validate substitution. */
  variables: string[]
}

export type PromptRepository = {
  findActive(key: string): Promise<{
    id: string
    version: number
    body: string
    model: string | null
    temperature: number | null
    variables: unknown
  } | null>
}

export async function resolvePrompt(
  key: string,
  fallbackBody: string,
  repository: PromptRepository = prismaPromptRepository,
): Promise<ResolvedPrompt> {
  /**
   * A template that cannot be read must not take the conversation down with it.
   *
   * `try`/`catch` rather than `.catch()` on the promise: `getPrisma()` throws
   * SYNCHRONOUSLY when `DATABASE_URL` is absent, so the promise is never created and a
   * `.catch()` on it never runs.
   */
  let active: Awaited<ReturnType<PromptRepository["findActive"]>> = null
  try {
    active = await repository.findActive(key)
  } catch {
    active = null
  }

  if (!active) {
    return { templateId: null, version: null, body: fallbackBody, model: null, temperature: null, variables: [] }
  }
  return {
    templateId: active.id,
    version: active.version,
    body: active.body,
    model: active.model,
    temperature: active.temperature,
    variables: Array.isArray(active.variables) ? active.variables.filter((name): name is string => typeof name === "string") : [],
  }
}

/** Every `{{name}}` reference in a body, in order of appearance. */
export function referencedVariables(body: string): string[] {
  const names = new Set<string>()
  for (const match of body.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) names.add(match[1])
  return [...names]
}

/**
 * Substitute declared variables into a body.
 *
 * A reference to a variable the caller did not supply is an error rather than an
 * empty string. The failure mode being avoided is a prompt that silently loses the
 * product description and still produces confident, plausible, unrelated output.
 */
export function renderPrompt(body: string, values: Record<string, string>): string {
  const missing = referencedVariables(body).filter((name) => !(name in values))
  if (missing.length > 0) throw new Error(`PROMPT_VARIABLE_MISSING:${missing.join(",")}`)
  return body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, name: string) => values[name])
}

/**
 * Validate a template before it is activated.
 *
 * Checks both directions. A body referencing an undeclared variable would fail at
 * render time in front of a user; a declared variable the body never uses is a
 * sign the wording was edited and the declaration was not.
 */
export function validateTemplate(body: string, declared: string[]): { ok: true } | { ok: false; reason: string } {
  const referenced = referencedVariables(body)
  const undeclared = referenced.filter((name) => !declared.includes(name))
  if (undeclared.length > 0) return { ok: false, reason: `UNDECLARED_VARIABLES:${undeclared.join(",")}` }
  const unused = declared.filter((name) => !referenced.includes(name))
  if (unused.length > 0) return { ok: false, reason: `UNUSED_VARIABLES:${unused.join(",")}` }
  return { ok: true }
}

const prismaPromptRepository: PromptRepository = {
  findActive(key) {
    // At most one version per key is active, enforced by a partial unique index.
    return getPrisma().promptTemplate.findFirst({
      where: { key, active: true },
      orderBy: { version: "desc" },
      select: { id: true, version: true, body: true, model: true, temperature: true, variables: true },
    })
  },
}
