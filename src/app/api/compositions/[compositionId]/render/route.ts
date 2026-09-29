import { renderComposition } from "@/features/compositions/service"
import { requireUser } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/**
 * Start the master render.
 *
 * Tightly rate limited, unlike the editing routes. This is the one that costs minutes
 * of CPU on a host with four shared cores, and the queue deduplicates per composition
 * anyway — so a user hammering the button joins the existing job rather than starting
 * a second encode, and the limit stops them queueing renders of a dozen different
 * compositions at once.
 */

async function POSTHandler(_request: Request, context: { params: Promise<{ compositionId: string }> }) {
  const user = await requireUser()
  const { compositionId } = await context.params

  const limit = await rateLimiter.check({
    action: "composition-render",
    identifier: user.id,
    limit: 6,
    windowSeconds: 300,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  try {
    const queued = await renderComposition(compositionId, user.id)
    return Response.json(queued, { status: 202 })
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message, code: error.message }, { status: error.status })
    }
    throw error
  }
}

export const POST = route(POSTHandler)
