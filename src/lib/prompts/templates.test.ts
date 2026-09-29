import { describe, expect, it, vi } from "vitest"

import { referencedVariables, renderPrompt, resolvePrompt, validateTemplate } from "./templates"

/**
 * Prompt templates exist so tone can be tuned without a deploy, which means an
 * administrator can also break one. The checks here are about failing where a
 * person can see it — at save time, or loudly at render — rather than shipping a
 * prompt that lost the product description and still produces confident output.
 */

describe("renderPrompt", () => {
  it("substitutes every occurrence of a variable", () => {
    expect(renderPrompt("Shoot {{product}}. Again: {{product}}.", { product: "a bottle" })).toBe(
      "Shoot a bottle. Again: a bottle.",
    )
  })

  it("tolerates whitespace inside the braces", () => {
    expect(renderPrompt("Shoot {{ product }}.", { product: "a bottle" })).toBe("Shoot a bottle.")
  })

  it("throws rather than silently rendering a variable the caller never supplied", () => {
    // The failure being avoided: a prompt that quietly loses the product
    // description and still produces plausible, unrelated output.
    expect(() => renderPrompt("Shoot {{product}} for {{audience}}.", { product: "a bottle" })).toThrow(
      "PROMPT_VARIABLE_MISSING:audience",
    )
  })

  it("names every missing variable at once", () => {
    expect(() => renderPrompt("{{a}} {{b}}", {})).toThrow("PROMPT_VARIABLE_MISSING:a,b")
  })

  it("leaves a body with no variables untouched", () => {
    expect(renderPrompt("Be brief.", {})).toBe("Be brief.")
  })
})

describe("referencedVariables", () => {
  it("collects each name once, in order of appearance", () => {
    expect(referencedVariables("{{b}} {{a}} {{b}}")).toEqual(["b", "a"])
  })

  it("ignores single braces and other punctuation", () => {
    expect(referencedVariables("{not a variable} {{real}}")).toEqual(["real"])
  })
})

describe("validateTemplate", () => {
  it("accepts a body whose references exactly match its declaration", () => {
    expect(validateTemplate("Shoot {{product}}.", ["product"])).toEqual({ ok: true })
  })

  it("rejects a reference that was never declared", () => {
    const result = validateTemplate("Shoot {{product}} for {{audience}}.", ["product"])
    expect(result).toEqual({ ok: false, reason: "UNDECLARED_VARIABLES:audience" })
  })

  it("rejects a declaration the body stopped using", () => {
    // A leftover declaration is the signal that the wording was edited and the
    // variable list was not, which is how the next edit breaks silently.
    const result = validateTemplate("Shoot {{product}}.", ["product", "audience"])
    expect(result).toEqual({ ok: false, reason: "UNUSED_VARIABLES:audience" })
  })
})

describe("resolvePrompt", () => {
  it("returns the active template and the version that answered", async () => {
    const resolved = await resolvePrompt("agent.brief_director", "built-in", {
      findActive: vi.fn(async () => ({
        id: "tpl_1",
        version: 3,
        body: "Custom instructions.",
        model: "gpt-5",
        temperature: 0.4,
        variables: ["product"],
      })),
    })

    expect(resolved).toEqual({
      templateId: "tpl_1",
      version: 3,
      body: "Custom instructions.",
      model: "gpt-5",
      temperature: 0.4,
      variables: ["product"],
    })
  })

  it("falls back to the built-in default with a null template id", async () => {
    const resolved = await resolvePrompt("agent.brief_director", "built-in", {
      findActive: vi.fn(async () => null),
    })
    // Recorded as null rather than as a fake id, so the run says honestly that no
    // template produced it.
    expect(resolved).toMatchObject({ templateId: null, version: null, body: "built-in" })
  })

  it("falls back when the template cannot be read at all", async () => {
    // A fresh database, or a lookup failing mid-conversation, must not take the
    // conversation down with it.
    const resolved = await resolvePrompt("agent.brief_director", "built-in", {
      findActive: vi.fn(async () => {
        throw new Error("connection terminated")
      }),
    })
    expect(resolved.body).toBe("built-in")
  })

  it("falls back when the repository throws synchronously", async () => {
    // `getPrisma()` throws synchronously when DATABASE_URL is absent, so the promise is
    // never created and a `.catch()` on it never runs. Worth its own case: the async
    // version above passes while this one crashes the caller.
    const resolved = await resolvePrompt("agent.brief_director", "built-in", {
      findActive: () => {
        throw new Error("DATABASE_URL is required for database access")
      },
    })
    expect(resolved.body).toBe("built-in")
  })

  it("ignores a malformed variable list instead of throwing on it", async () => {
    const resolved = await resolvePrompt("k", "built-in", {
      findActive: vi.fn(async () => ({
        id: "tpl_1",
        version: 1,
        body: "Body.",
        model: null,
        temperature: null,
        variables: "not an array",
      })),
    })
    expect(resolved.variables).toEqual([])
  })
})
