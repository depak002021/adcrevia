import { projectSpend } from "@/features/costs/service"
import { requireUser } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

type Context = RouteContext<"/api/projects/[projectId]/spend">

/** What this project has cost so far, from its generation logs. */
async function GETHandler(_request: Request, context: Context) {
  const user = await requireUser()
  const { projectId } = await context.params
  const spend = await projectSpend(projectId, user.id)
  if (!spend) return Response.json({ error: "Project not found." }, { status: 404 })
  return Response.json({ spend })
}

export const GET = route(GETHandler)
