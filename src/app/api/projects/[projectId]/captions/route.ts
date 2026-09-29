import { getSocialCopy, writeSocialCopy } from "@/features/captions/service"
import { requireUser } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

type Context = RouteContext<"/api/projects/[projectId]/captions">

/** The stored captions; never calls a model. */
async function GETHandler(_request: Request, context: Context) {
  const user = await requireUser()
  const { projectId } = await context.params
  return Response.json({ copy: await getSocialCopy(projectId, user.id) })
}

/** Write (or rewrite) the captions: one text call, on the user's request only. */
async function POSTHandler(_request: Request, context: Context) {
  const user = await requireUser()
  const limit = await rateLimiter.check({ action: "captions-write", identifier: user.id, limit: 10, windowSeconds: 60 * 60 })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)
  const { projectId } = await context.params
  try {
    return Response.json({ copy: await writeSocialCopy(projectId, user.id) }, { status: 201 })
  } catch (error) {
    if (error instanceof HttpError) throw error
    console.error("[captions] could not write", { projectId, reason: error instanceof Error ? error.message.slice(0, 120) : "unknown" })
    return Response.json({ error: "Captions could not be written right now. Check the AI text key in Admin → AI text, then try again." }, { status: 502 })
  }
}

export const GET = route(GETHandler)
export const POST = route(POSTHandler)
