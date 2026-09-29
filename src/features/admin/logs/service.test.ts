import { describe, expect, it } from "vitest"

import { onePerGeneration, sanitizeDiagnostic } from "./service"

describe("generation log sanitization", () => {
  it("redacts sensitive keys and bearer-style secrets recursively", () => {
    const result = sanitizeDiagnostic({
      message: "Provider rejected Authorization: Bearer secret-key-123",
      authorization: "Bearer secret-key-123",
      nested: { apiKey: "sk-private", detail: "safe operational context" },
    })
    expect(JSON.stringify(result)).not.toContain("secret-key-123")
    expect(JSON.stringify(result)).not.toContain("sk-private")
    expect(result).toMatchObject({ authorization: "[REDACTED]", nested: { apiKey: "[REDACTED]", detail: "safe operational context" } })
  })
})

describe("onePerGeneration", () => {
  it("drops a render's started row once its outcome is logged, keeps renders still in progress", () => {
    const rows = [
      { id: "a2", status: "SUCCEEDED", subjectId: "v1" },
      { id: "a1", status: "STARTED", subjectId: "v1" },
      { id: "b1", status: "STARTED", subjectId: "v2" },
      { id: "c1", status: "FAILED", subjectId: null },
    ]
    expect(onePerGeneration(rows).map((row) => row.id)).toEqual(["a2", "b1", "c1"])
  })
})
