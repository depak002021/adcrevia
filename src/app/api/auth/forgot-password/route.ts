import { z } from "zod"

import { PasswordResetService } from "@/features/auth/password-reset"
import { passwordResetRepository } from "@/features/auth/password-reset-repository"
import { sendPasswordResetEmail } from "@/lib/email/resend"
import { clientIdentifier, rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"
import { route } from "@/lib/http/route"

const inputSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) })

async function POSTHandler(request: Request) {
  const limit = await rateLimiter.check({
    action: "forgot-password",
    identifier: clientIdentifier(request),
    limit: 5,
    windowSeconds: 15 * 60,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 })

  const service = new PasswordResetService(passwordResetRepository, {
    appUrl: process.env.APP_URL ?? new URL(request.url).origin,
    sendResetEmail: sendPasswordResetEmail,
  })
  try {
    await service.request(parsed.data.email)
  } catch {
    return Response.json({ error: "We couldn’t send the reset email. Please try again shortly." }, { status: 503 })
  }
  return Response.json({ ok: true })
}

export const POST = route(POSTHandler)
