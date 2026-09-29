import { briefOpeningSchema, startBriefConversation } from "@/features/brief/service"
import { requireUser } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/**
 * Start a project by saying something.
 *
 * Separate from `POST /api/projects` because the two have genuinely different
 * contracts. That route takes a finished brief and enforces a twelve-character
 * minimum; this one accepts "candles" and lets the agent ask the next question,
 * which is the entire difference between a form and a conversation.
 */

async function POSTHandler(request: Request) {
  const user = await requireUser()

  const limit = await rateLimiter.check({
    action: "brief-start",
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  // JSON, or multipart when the user attached product photos on the create screen.
  let body: unknown = null
  let photos: File[] = []
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null)
    if (form) {
      const websiteUrl = form.get("websiteUrl")
      body = { message: form.get("message"), ...(typeof websiteUrl === "string" && websiteUrl ? { websiteUrl } : {}) }
      photos = form.getAll("photo").filter((entry): entry is File => entry instanceof File)
    }
  } else {
    body = await request.json().catch(() => null)
  }

  const parsed = briefOpeningSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Tell us a little about the product." },
      { status: 400 },
    )
  }

  const started = await startBriefConversation({
    userId: user.id,
    message: parsed.data.message,
    websiteUrl: parsed.data.websiteUrl,
    photos,
  })

  return Response.json(started, { status: 201 })
}

export const POST = route(POSTHandler)
