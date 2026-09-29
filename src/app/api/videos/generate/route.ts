import { videoErrorResponse } from "@/features/videos/errors"
import { startVideoGeneration } from "@/features/videos/service"
import { requireUser } from "@/lib/auth/guards"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"
import { route } from "@/lib/http/route"

async function POSTHandler(request: Request) {
  const user = await requireUser()
  const limit = await rateLimiter.check({ action: "video-generation", identifier: user.id, limit: 6, windowSeconds: 60 * 60 })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)
  try {
    const video = await startVideoGeneration(await request.json().catch(() => null), user.id)
    return Response.json({ video }, { status: 201 })
  } catch (error) {
    return videoErrorResponse(error, "Video generation could not start.")
  }
}

export const POST = route(POSTHandler)
