import { testEmailConfiguration } from "@/features/admin/email/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/**
 * Send a real test email to the signed-in administrator.
 *
 * Rate limited despite being admin-only: each call logs in to the mail server and
 * sends a message, and a stuck retry loop could otherwise get the mailbox throttled
 * or flagged by the provider.
 */

async function POSTHandler(request: Request) {
  const admin = await requireSuperAdmin()

  const limit = await rateLimiter.check({
    action: "email-test",
    identifier: admin.id,
    limit: 5,
    windowSeconds: 60,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  return Response.json({ email: await testEmailConfiguration(await request.json().catch(() => null), admin) })
}

export const POST = route(POSTHandler)
