import { compositionInput } from "@/features/compositions/schemas"
import { createComposition } from "@/features/compositions/service"
import { requireUser } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/**
 * Create an edit.
 *
 * Creating is separate from rendering on purpose: arranging clips is free and happens
 * repeatedly, and encoding is minutes of CPU on a shared host. Collapsing them into one
 * call would mean every reorder started a render.
 */

async function POSTHandler(request: Request) {
  const user = await requireUser()

  const limit = await rateLimiter.check({
    action: "composition-create",
    identifier: user.id,
    limit: 20,
    windowSeconds: 60,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  const parsed = compositionInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json(
      { error: "Check the timeline and try again.", code: parsed.error.issues[0]?.code },
      { status: 400 },
    )
  }

  try {
    const composition = await createComposition(parsed.data, user.id)
    return Response.json({ composition }, { status: 201 })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}

export const POST = route(POSTHandler)
