import { HttpError } from "./http-error"

/**
 * Safety net for route handlers.
 *
 * The problem this solves: `requireUser()` and `requireSuperAdmin()` throw
 * `HttpError`, but there is no global handler for App Router route handlers, and
 * most routes never caught it. An unauthenticated request to `/api/projects`
 * therefore surfaced as an unhandled exception — a 500 with a stack trace — when
 * it should be a 401. Clients could not tell "sign in again" from "the server is
 * broken", and every expired session produced a false alarm in the logs.
 *
 * Deliberately a net, not a funnel: each route keeps its own error taxonomy for
 * the domain failures it understands (provider unavailable, aspect ratio
 * unsupported, and so on). This only handles what escapes, so wrapping a route
 * never changes a response it was already producing correctly.
 */

/** Uniform error envelope. The client only ever has to read one shape. */
export type ErrorBody = {
  error: string
  /** Stable machine-readable code, when the client needs to branch on it. */
  code?: string
  /** Field-level messages for form validation failures. */
  fields?: Record<string, string>
}

type Handler<Args extends unknown[]> = (
  request: Request,
  ...args: Args
) => Response | Promise<Response>

export function route<Args extends unknown[]>(handler: Handler<Args>): Handler<Args> {
  return async (request, ...args) => {
    try {
      return await handler(request, ...args)
    } catch (error) {
      return toErrorResponse(error, request)
    }
  }
}

/** Duck-typed so a ZodError from any zod instance is recognised. */
function isZodError(error: unknown): error is { issues: { path: (string | number)[]; message: string }[] } {
  return Boolean(
    error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown }).issues),
  )
}

export function toErrorResponse(error: unknown, request?: Request): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message } satisfies ErrorBody, {
      status: error.status,
      // A 401 from an expired session must never be cached by a proxy.
      headers: { "cache-control": "no-store" },
    })
  }

  if (isZodError(error)) {
    const fields: Record<string, string> = {}
    for (const issue of error.issues) {
      const key = String(issue.path[0] ?? "form")
      // First message per field wins, matching how the forms surface errors.
      if (!fields[key]) fields[key] = issue.message
    }
    return Response.json(
      { error: "Some details need attention.", code: "VALIDATION_FAILED", fields } satisfies ErrorBody,
      { status: 400 },
    )
  }

  // Unrecognised failure. Log the name and message only — never the error object
  // or a stack — so a provider response body or credential can never reach the
  // logs, and never the client.
  const name = error instanceof Error ? error.name : "UnknownError"
  const message = error instanceof Error ? error.message : String(error)
  console.error("[route] unhandled", {
    name,
    message,
    method: request?.method,
    path: request ? safePath(request.url) : undefined,
  })

  return Response.json(
    { error: "Something went wrong on our side. Please try again." } satisfies ErrorBody,
    { status: 500 },
  )
}

/** Path only — query strings can carry user content we should not log. */
function safePath(url: string) {
  try {
    return new URL(url).pathname
  } catch {
    return undefined
  }
}
