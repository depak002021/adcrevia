import { exportInput } from "@/features/compositions/schemas"
import { exportComposition } from "@/features/compositions/service"
import { requireUser } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/**
 * Encode the master for one or more destinations.
 *
 * Each destination is its own job and its own row, so one platform failing does not
 * take the others with it and a single preset can be retried on its own. They queue at
 * a lower priority than the master render: nobody is watching an export the way they
 * watch the edit they just made.
 */

async function POSTHandler(request: Request, context: { params: Promise<{ compositionId: string }> }) {
  const user = await requireUser()
  const { compositionId } = await context.params

  const limit = await rateLimiter.check({
    action: "composition-export",
    identifier: user.id,
    limit: 12,
    windowSeconds: 300,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  const parsed = exportInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Choose at least one destination." }, { status: 400 })

  try {
    const queued = await exportComposition(compositionId, parsed.data.presets, user.id)
    return Response.json(queued, { status: 202 })
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message, code: error.message }, { status: error.status })
    }
    throw error
  }
}

export const POST = route(POSTHandler)
