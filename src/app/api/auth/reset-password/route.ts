import { z } from "zod"

import { PasswordResetError, PasswordResetService } from "@/features/auth/password-reset"
import { passwordResetRepository } from "@/features/auth/password-reset-repository"
import { sendPasswordResetEmail } from "@/lib/email/resend"
import { clientIdentifier, rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"
import { route } from "@/lib/http/route"

const inputSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(128),
})

async function POSTHandler(request: Request) {
  const limit = await rateLimiter.check({
    action: "reset-password",
    identifier: clientIdentifier(request),
    limit: 10,
    windowSeconds: 15 * 60,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Check the reset link and password." }, { status: 400 })

  const service = new PasswordResetService(passwordResetRepository, {
    appUrl: process.env.APP_URL ?? new URL(request.url).origin,
    sendResetEmail: sendPasswordResetEmail,
  })
  try {
    await service.reset(parsed.data.token, parsed.data.password)
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof PasswordResetError && error.code === "RESET_TOKEN_INVALID") {
      return Response.json({ error: "This reset link is invalid or has expired." }, { status: 400 })
    }
    throw error
  }
}

export const POST = route(POSTHandler)
