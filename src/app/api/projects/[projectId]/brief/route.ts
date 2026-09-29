import { z } from "zod"

import { postUserMessage } from "@/features/brief/service"
import { readBriefTranscript } from "@/features/brief/transcript"
import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/**
 * The conversational brief.
 *
 * POST records the user's turn and queues the agent, returning 202 immediately. The
 * reply is not in the response, because composing it can involve several model calls
 * and a website crawl — the client watches `/api/projects/:id/events`, where the
 * transcript arrives on the snapshot alongside everything else.
 *
 * GET is the fallback for a first render or a client with no stream open.
 *
 * Params are typed explicitly rather than via `RouteContext<...>`: that helper reads
 * from Next's generated route registry, which does not contain a route until a build
 * has run, so a freshly added handler fails typecheck before it has ever been built.
 */

const messageSchema = z.object({
  message: z.string().trim().min(1, "Say something first.").max(4_000),
})

async function POSTHandler(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await requireUser()
  const { projectId } = await context.params

  // A turn costs a model call and possibly a crawl, so the window is tighter than
  // the enqueue-only routes.
  const limit = await rateLimiter.check({
    action: "brief-message",
    identifier: user.id,
    limit: 30,
    windowSeconds: 60,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  const parsed = messageSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid message." }, { status: 400 })
  }

  try {
    const result = await postUserMessage({
      projectId,
      userId: user.id,
      content: parsed.data.message,
    })
    return Response.json(result, { status: 202 })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}

async function GETHandler(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await requireUser()
  const { projectId } = await context.params

  // Ownership is checked here rather than inside the transcript read, so the
  // transcript function stays usable from the snapshot, which has already checked.
  const owned = await getPrisma().project.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  })
  if (!owned) return Response.json({ error: "Project not found." }, { status: 404 })

  const transcript = await readBriefTranscript(projectId)
  return Response.json({ brief: transcript })
}

export const POST = route(POSTHandler)
export const GET = route(GETHandler)
