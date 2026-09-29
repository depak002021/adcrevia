import { describe, expect, it } from "vitest"

import { reasoningFor } from "./reasoning"

describe("reasoningFor", () => {
  it("sets the effort on reasoning models only", () => {
    expect(reasoningFor("gpt-5-mini", "low")).toEqual({ reasoning: { effort: "low" } })
    expect(reasoningFor("gpt-4.1-mini", "low")).toEqual({})
    expect(reasoningFor("gpt-5-chat-latest", "low")).toEqual({})
  })

  it("uses low where minimal is not accepted", () => {
    expect(reasoningFor("gpt-5-nano", "minimal")).toEqual({ reasoning: { effort: "minimal" } })
    expect(reasoningFor("gpt-5.2", "minimal")).toEqual({ reasoning: { effort: "low" } })
  })
})
