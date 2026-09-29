import { getPrisma } from "@/lib/db/prisma"

/**
 * Which OpenAI models do the writing.
 *
 * Three roles, each settable from Admin → AI text without a deploy:
 *   text      creative writing (directions, prompts, copy)
 *   agent     the brief conversation; needs tool calling
 *   decision  the cheap classifier behind the decision layer
 *
 * Resolution per role: console setting, then the environment variable, then the
 * default. `agent` and `decision` fall back to whatever `text` resolved to, which is
 * how the environment variables already behaved.
 *
 * A database that cannot be read is treated as "nothing set", the same way storage
 * resolution treats it: writing must keep working on the environment values rather
 * than fail because a settings read did.
 */

export const DEFAULT_TEXT_MODEL = "gpt-5-mini"

export const TEXT_MODEL_SETTING_KEYS = {
  text: "ai.openai.textModel",
  agent: "ai.openai.agentModel",
  decision: "ai.openai.decisionModel",
} as const

export type TextModelRole = keyof typeof TEXT_MODEL_SETTING_KEYS
export type TextModelSource = "database" | "environment" | "default"

export type ResolvedTextModels = Record<TextModelRole, string> & {
  source: Record<TextModelRole, TextModelSource>
}

type Environment = Record<string, string | undefined>
export type TextModelSettingsReader = (keys: string[]) => Promise<Record<string, unknown>>

const ENV_KEYS: Record<TextModelRole, string> = {
  text: "OPENAI_TEXT_MODEL",
  agent: "OPENAI_AGENT_MODEL",
  decision: "OPENAI_DECISION_MODEL",
}

export async function resolveTextModels(
  environment: Environment = process.env,
  read: TextModelSettingsReader = readSystemSettings,
): Promise<ResolvedTextModels> {
  let stored: Record<string, unknown> = {}
  try {
    stored = await read(Object.values(TEXT_MODEL_SETTING_KEYS))
  } catch {
    stored = {}
  }

  const pick = (role: TextModelRole): { value: string | null; source: TextModelSource } => {
    const fromDatabase = modelName(stored[TEXT_MODEL_SETTING_KEYS[role]])
    if (fromDatabase) return { value: fromDatabase, source: "database" }
    const fromEnvironment = modelName(environment[ENV_KEYS[role]])
    if (fromEnvironment) return { value: fromEnvironment, source: "environment" }
    return { value: null, source: "default" }
  }

  const text = pick("text")
  const agent = pick("agent")
  const decision = pick("decision")
  const textModel = text.value ?? DEFAULT_TEXT_MODEL

  return {
    text: textModel,
    agent: agent.value ?? textModel,
    decision: decision.value ?? textModel,
    source: { text: text.source, agent: agent.source, decision: decision.source },
  }
}

function modelName(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

async function readSystemSettings(keys: string[]) {
  const rows = await getPrisma().systemSetting.findMany({ where: { key: { in: keys } } })
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}
