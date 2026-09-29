import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { decryptCredential, encryptCredential, maskCredential } from "./provider-credentials"

const originalKey = process.env.ENCRYPTION_KEY

describe("provider credential encryption", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = originalKey
  })

  it("round-trips with authenticated encryption and never includes plaintext", () => {
    const encrypted = encryptCredential("sk-secret-value")
    expect(JSON.stringify(encrypted)).not.toContain("sk-secret-value")
    expect(decryptCredential(encrypted)).toBe("sk-secret-value")
  })

  it("rejects a tampered credential", () => {
    const encrypted = encryptCredential("sk-secret-value")
    const bytes = Buffer.from(encrypted.ciphertext, "base64")
    bytes[0] ^= 1
    expect(() => decryptCredential({ ...encrypted, ciphertext: bytes.toString("base64") })).toThrow()
  })

  it("returns a fixed mask that reveals no key characters", () => {
    expect(maskCredential("sk-secret-value")).toBe("••••••••••••")
  })
})
