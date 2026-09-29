import { recordWaitlistSignup } from "@/features/marketing/service"
import { honeypotField } from "@/features/marketing/waitlist"
import { route } from "@/lib/http/route"
import { clientIdentifier, rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/**
 * Waitlist signups.
 *
 * Replaces the PHP handler that shipped beside the static marketing export. Public and
 * unauthenticated by necessity — it is a signup form — so the protections are the ones
 * that work without an identity:
 *
 *  - A per-IP rate limit. The address is the only stable thing about an anonymous
 *    caller, and the window is generous enough that a shared office network is not
 *    locked out by two colleagues signing up.
 *  - A hidden decoy field, checked before validation. Anything in it gets the same
 *    confirmation as a real signup and is written nowhere, so a bot cannot tell it was
 *    caught and try something else.
 *  - Nothing in the response that depends on whether the address was already on the
 *    list, which would otherwise make this an oracle for "does this person use
 *    Adcrevia".
 */

async function POSTHandler(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null

  // Checked before anything else, including the rate limit: a caught bot should not
  // consume a real visitor's budget on a shared address.
  if (typeof body?.[honeypotField] === "string" && body[honeypotField].trim() !== "") {
    return Response.json({ ok: true }, { status: 202 })
  }

  const limit = await rateLimiter.check({
    action: "waitlist",
    identifier: clientIdentifier(request),
    limit: 8,
    windowSeconds: 600,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  const result = await recordWaitlistSignup(body)
  if (!result.ok) {
    return Response.json(
      { ok: false, message: "Check the fields below and try again.", fieldErrors: result.fieldErrors },
      { status: 400 },
    )
  }

  // The same body whether the row was created or updated. A different response for a
  // repeat signup would confirm an address is already registered.
  return Response.json({ ok: true }, { status: 201 })
}

export const POST = route(POSTHandler)
