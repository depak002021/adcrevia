import { describe, expect, it } from "vitest"

import { resolveTextModels, TEXT_MODEL_SETTING_KEYS } from "./text-models"

const none = async () => ({})

describe("resolveTextModels", () => {
  it("uses the default when nothing is set, and agent/decision follow the text model", async () => {
    await expect(resolveTextModels({}, none)).resolves.toMatchObject({
      text: "gpt-5-mini",
      agent: "gpt-5-mini",
      decision: "gpt-5-mini",
      source: { text: "default", agent: "default", decision: "default" },
    })
  })

  it("prefers the console setting over the environment, per role", async () => {
    const read = async () => ({ [TEXT_MODEL_SETTING_KEYS.text]: "gpt-5.2", [TEXT_MODEL_SETTING_KEYS.decision]: " gpt-5-nano " })
    const models = await resolveTextModels({ OPENAI_TEXT_MODEL: "env-text", OPENAI_AGENT_MODEL: "env-agent" }, read)
    expect(models).toMatchObject({ text: "gpt-5.2", agent: "env-agent", decision: "gpt-5-nano" })
    expect(models.source).toEqual({ text: "database", agent: "environment", decision: "database" })
  })

  it("falls back to the environment when the settings cannot be read", async () => {
    const failing = async () => {
      throw new Error("database down")
    }
    await expect(resolveTextModels({ OPENAI_TEXT_MODEL: "env-text" }, failing)).resolves.toMatchObject({
      text: "env-text",
      agent: "env-text",
    })
  })

  it("ignores blank and non-string stored values", async () => {
    const read = async () => ({ [TEXT_MODEL_SETTING_KEYS.text]: "  ", [TEXT_MODEL_SETTING_KEYS.agent]: 42 })
    await expect(resolveTextModels({}, read)).resolves.toMatchObject({ text: "gpt-5-mini", agent: "gpt-5-mini" })
  })
})
