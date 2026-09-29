import { compositionUpdateInput } from "@/features/compositions/schemas"
import { readComposition, updateComposition } from "@/features/compositions/service"
import { requireUser } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"

/**
 * Read or rearrange one edit.
 *
 * Params are typed explicitly rather than via `RouteContext<...>`: that helper reads
 * from Next's generated route registry, which does not contain a route until a build
 * has run, so a freshly added handler fails typecheck before it has ever been built.
 */

async function GETHandler(_request: Request, context: { params: Promise<{ compositionId: string }> }) {
  const user = await requireUser()
  const { compositionId } = await context.params

  try {
    return Response.json({ composition: await readComposition(compositionId, user.id) })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}

async function PATCHHandler(request: Request, context: { params: Promise<{ compositionId: string }> }) {
  const user = await requireUser()
  const { compositionId } = await context.params

  const parsed = compositionUpdateInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Check the timeline and try again." }, { status: 400 })

  try {
    const composition = await updateComposition(compositionId, parsed.data, user.id)
    return Response.json({ composition })
  } catch (error) {
    if (error instanceof HttpError) {
      // 409 carries a code rather than prose: the UI has to distinguish "still
      // rendering" from a validation problem to decide whether to offer a retry.
      return Response.json(
        { error: error.message, code: error.status === 409 ? error.message : undefined },
        { status: error.status },
      )
    }
    throw error
  }
}

export const GET = route(GETHandler)
export const PATCH = route(PATCHHandler)
