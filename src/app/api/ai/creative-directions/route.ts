import { z } from "zod"

import { createDirections } from "@/features/directions/service"
import { requireUser } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"

const schema = z.object({ projectId: z.string().cuid() })

async function POSTHandler(request: Request) {
  const user = await requireUser()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid project." }, { status: 400 })
  try {
    return Response.json({ directions: await createDirections(parsed.data.projectId, user.id) })
  } catch (error) {
    return mapDirectionsError(error)
  }
}

function mapDirectionsError(error: unknown) {
  // Ownership / not-found and other explicit HTTP errors keep their status.
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status })
  }

  // Provider not configured — actionable admin guidance.
  if (error instanceof Error && error.message === "OPENAI_API_KEY is required") {
    return Response.json({ error: "Connect OpenAI in the admin console to generate live directions." }, { status: 503 })
  }

  // The model returned output that did not satisfy the structured-output
  // contract, or the generated directions were not distinct.
  if (
    error instanceof z.ZodError ||
    (error instanceof Error &&
      (error.message === "OPENAI_STRUCTURED_OUTPUT_REQUIRED" || error.message === "DIRECTIONS_MUST_BE_DISTINCT"))
  ) {
    logDirectionsError("invalid_model_output", error)
    return Response.json({ error: "The model returned an unusable response. Please try again." }, { status: 502 })
  }

  // Upstream provider rejection (OpenAI SDK errors expose a numeric status).
  const status = getUpstreamStatus(error)
  if (status === 401 || status === 403) {
    logDirectionsError("provider_auth", error)
    return Response.json({ error: "The OpenAI credential was rejected. Check the key in the admin console." }, { status: 502 })
  }
  if (status === 429) {
    logDirectionsError("provider_rate_limit", error)
    return Response.json({ error: "OpenAI is rate limiting requests. Please wait and try again." }, { status: 502 })
  }

  logDirectionsError("unknown", error)
  return Response.json({ error: "Creative directions are temporarily unavailable." }, { status: 502 })
}

function getUpstreamStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status: unknown }).status)
    return Number.isFinite(status) ? status : undefined
  }
  return undefined
}

/**
 * Server-only diagnostic log. Records the error category, name, and message so
 * failures are debuggable, but never serializes the full error object (which
 * could carry request bodies, prompts, or credential fragments).
 */
function logDirectionsError(category: string, error: unknown) {
  const name = error instanceof Error ? error.name : typeof error
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[creative-directions] ${category}: ${name}: ${message}`)
}

export const POST = route(POSTHandler)
