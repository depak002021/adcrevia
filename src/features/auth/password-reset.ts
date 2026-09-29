import { createHash, randomBytes } from "node:crypto"

import { hashPassword as createPasswordHash } from "@/lib/auth/password"

export type PasswordResetRepository = {
  findActiveUserByEmail(email: string): Promise<{ id: string; email: string; name: string | null } | null>
  replaceToken(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>
  consumeToken(tokenHash: string, now: Date): Promise<{ id: string; userId: string } | null>
  updatePasswordAndRevokeSessions(userId: string, passwordHash: string): Promise<void>
}

type PasswordResetOptions = {
  appUrl: string
  sendResetEmail(input: { to: string; name: string | null; resetUrl: string }): Promise<void>
  now?: () => Date
  createToken?: () => string
  hashPassword?: (password: string) => Promise<string>
}

export class PasswordResetError extends Error {
  constructor(public readonly code: "RESET_TOKEN_INVALID") {
    super(code)
  }
}

export class PasswordResetService {
  constructor(
    private readonly repository: PasswordResetRepository,
    private readonly options: PasswordResetOptions,
  ) {}

  async request(untrustedEmail: string) {
    const email = untrustedEmail.trim().toLowerCase()
    const user = await this.repository.findActiveUserByEmail(email)
    if (!user) return { ok: true as const }

    const token = this.options.createToken?.() ?? randomBytes(32).toString("base64url")
    const now = this.options.now?.() ?? new Date()
    await this.repository.replaceToken({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    })

    try {
      const resetUrl = new URL("/reset-password", this.options.appUrl)
      resetUrl.searchParams.set("token", token)
      await this.options.sendResetEmail({ to: user.email, name: user.name, resetUrl: resetUrl.toString() })
    } catch {
      // A uniform response prevents account enumeration during provider outages.
    }
    return { ok: true as const }
  }

  async reset(token: string, password: string) {
    const now = this.options.now?.() ?? new Date()
    const consumed = await this.repository.consumeToken(hashToken(token), now)
    if (!consumed) throw new PasswordResetError("RESET_TOKEN_INVALID")
    const passwordHash = await (this.options.hashPassword ?? createPasswordHash)(password)
    await this.repository.updatePasswordAndRevokeSessions(consumed.userId, passwordHash)
    return { ok: true as const }
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}
