import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { PasswordResetService, type PasswordResetRepository } from "./password-reset"

function repository(overrides: Partial<PasswordResetRepository> = {}): PasswordResetRepository {
  return {
    findActiveUserByEmail: vi.fn().mockResolvedValue({ id: "user_1", email: "ava@example.com", name: "Ava" }),
    replaceToken: vi.fn().mockResolvedValue(undefined),
    consumeToken: vi.fn().mockResolvedValue({ id: "token_1", userId: "user_1" }),
    updatePasswordAndRevokeSessions: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe("PasswordResetService", () => {
  it("stores only a SHA-256 token hash and emails the raw token", async () => {
    const repo = repository()
    const sendResetEmail = vi.fn().mockResolvedValue(undefined)
    const service = new PasswordResetService(repo, {
      now: () => new Date("2026-09-17T10:00:00.000Z"),
      createToken: () => "raw-secret-token",
      sendResetEmail,
      appUrl: "https://adcrevia.example",
    })

    await service.request("  AVA@EXAMPLE.COM ")

    expect(repo.replaceToken).toHaveBeenCalledWith({
      userId: "user_1",
      tokenHash: createHash("sha256").update("raw-secret-token").digest("hex"),
      expiresAt: new Date("2026-09-17T11:00:00.000Z"),
    })
    expect(sendResetEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "ava@example.com",
      resetUrl: "https://adcrevia.example/reset-password?token=raw-secret-token",
    }))
  })

  it("does not reveal whether an email exists", async () => {
    const repo = repository({ findActiveUserByEmail: vi.fn().mockResolvedValue(null) })
    const sendResetEmail = vi.fn()
    const service = new PasswordResetService(repo, { sendResetEmail, appUrl: "https://adcrevia.example" })

    await expect(service.request("missing@example.com")).resolves.toEqual({ ok: true })
    expect(repo.replaceToken).not.toHaveBeenCalled()
    expect(sendResetEmail).not.toHaveBeenCalled()
  })

  it("does not reveal an existing account when email delivery fails", async () => {
    const repo = repository()
    const service = new PasswordResetService(repo, {
      sendResetEmail: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      appUrl: "https://adcrevia.example",
    })

    await expect(service.request("ava@example.com")).resolves.toEqual({ ok: true })
  })

  it("consumes a valid token once and revokes existing sessions", async () => {
    const repo = repository()
    const service = new PasswordResetService(repo, {
      hashPassword: vi.fn().mockResolvedValue("argon-hash"),
      sendResetEmail: vi.fn(),
      appUrl: "https://adcrevia.example",
    })

    await expect(service.reset("raw-secret-token", "a-new-strong-password")).resolves.toEqual({ ok: true })
    expect(repo.consumeToken).toHaveBeenCalledWith(
      createHash("sha256").update("raw-secret-token").digest("hex"),
      expect.any(Date),
    )
    expect(repo.updatePasswordAndRevokeSessions).toHaveBeenCalledWith("user_1", "argon-hash")
  })

  it("rejects expired, used, or unknown tokens with one safe error", async () => {
    const repo = repository({ consumeToken: vi.fn().mockResolvedValue(null) })
    const service = new PasswordResetService(repo, { sendResetEmail: vi.fn(), appUrl: "https://adcrevia.example" })

    await expect(service.reset("invalid-token", "a-new-strong-password")).rejects.toThrow("RESET_TOKEN_INVALID")
    expect(repo.updatePasswordAndRevokeSessions).not.toHaveBeenCalled()
  })
})
