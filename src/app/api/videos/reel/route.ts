import { videoErrorResponse } from "@/features/videos/errors"
import { startReel } from "@/features/videos/reel"
import { requireUser } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/** Start an automatic reel (several clips joined with transitions). */
async function POSTHandler(request: Request) {
  const user = await requireUser()
  // Tighter than single videos: one reel is several paid renders.
  const limit = await rateLimiter.check({ action: "reel-generation", identifier: user.id, limit: 4, windowSeconds: 60 * 60 })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)
  try {
    return Response.json(await startReel(await request.json().catch(() => null), user.id), { status: 201 })
  } catch (error) {
    return videoErrorResponse(error, "The reel could not start.")
  }
}

export const POST = route(POSTHandler)
