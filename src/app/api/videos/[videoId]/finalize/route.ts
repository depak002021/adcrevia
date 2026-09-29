import { videoErrorResponse } from "@/features/videos/errors"
import { finalizeDraftVideo } from "@/features/videos/service"
import { requireUser } from "@/lib/auth/guards"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"
import { route } from "@/lib/http/route"

/**
 * Render the final 1080p video from an approved Seedance 2.5 draft. Idempotent: a
 * second request for the same draft returns the final already started, never a
 * second paid render. Shares the video-generation rate limit.
 */
async function POSTHandler(_request: Request, context: RouteContext<"/api/videos/[videoId]/finalize">) {
  const user = await requireUser()
  const limit = await rateLimiter.check({ action: "video-generation", identifier: user.id, limit: 6, windowSeconds: 60 * 60 })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)
  const { videoId } = await context.params
  try {
    return Response.json({ video: await finalizeDraftVideo(videoId, user.id) }, { status: 201 })
  } catch (error) {
    return videoErrorResponse(error, "The final video could not start.")
  }
}

export const POST = route(POSTHandler)
