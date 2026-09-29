import { testStorageConfiguration } from "@/features/admin/storage/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/**
 * Prove the bucket accepts an upload.
 *
 * Rate limited despite being an admin-only route: each call writes and deletes a real
 * object, and a stuck retry loop in a browser tab would otherwise fill a bucket with
 * healthcheck files.
 *
 * An empty body means "test whatever is already saved", which is the case that matters
 * after a key is rotated somewhere else.
 */

async function POSTHandler(request: Request) {
  const admin = await requireSuperAdmin()

  const limit = await rateLimiter.check({
    action: "storage-test",
    identifier: admin.id,
    limit: 10,
    windowSeconds: 60,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  try {
    const storage = await testStorageConfiguration(await request.json().catch(() => null), admin)
    return Response.json({ storage })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}

export const POST = route(POSTHandler)
