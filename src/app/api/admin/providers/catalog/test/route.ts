import { testCatalogKey } from "@/features/admin/providers/key-test"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/** Check a saved provider key with a free, read-only call. Never returns the key. */
async function POSTHandler(request: Request) {
  const admin = await requireSuperAdmin()
  const limit = await rateLimiter.check({ action: "provider-key-test", identifier: admin.id, limit: 20, windowSeconds: 60 })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)
  return Response.json(await testCatalogKey(await request.json().catch(() => null), admin))
}

export const POST = route(POSTHandler)
