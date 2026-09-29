import { createPromptVersion, deactivatePrompt, listPromptVersions } from "@/features/admin/prompts/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"

/**
 * Versions of one prompt.
 *
 * POST creates a new version rather than editing the current one, which is what makes a
 * bad wording change a rollback instead of a recovery. DELETE falls back to the wording
 * compiled into the application; it deactivates rather than deleting, so a run that
 * recorded the template can still be traced to it.
 *
 * Params are typed explicitly rather than via `RouteContext<...>`: that helper reads from
 * Next's generated route registry, which does not contain a route until a build has run.
 */

async function GETHandler(_request: Request, context: { params: Promise<{ key: string }> }) {
  await requireSuperAdmin()
  const { key } = await context.params

  try {
    return Response.json({ versions: await listPromptVersions(decodeURIComponent(key)) })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}

async function POSTHandler(request: Request, context: { params: Promise<{ key: string }> }) {
  const admin = await requireSuperAdmin()
  const { key } = await context.params

  try {
    const version = await createPromptVersion(
      decodeURIComponent(key),
      await request.json().catch(() => null),
      admin,
    )
    return Response.json({ version }, { status: 201 })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    // Zod rejections carry field detail that is useful here and safe: it is the
    // administrator's own input being described back to them.
    if (error && typeof error === "object" && "issues" in error) {
      return Response.json({ error: "Check the wording and try again." }, { status: 400 })
    }
    throw error
  }
}

async function DELETEHandler(_request: Request, context: { params: Promise<{ key: string }> }) {
  const admin = await requireSuperAdmin()
  const { key } = await context.params

  try {
    return Response.json(await deactivatePrompt(decodeURIComponent(key), admin))
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}

export const GET = route(GETHandler)
export const POST = route(POSTHandler)
export const DELETE = route(DELETEHandler)
