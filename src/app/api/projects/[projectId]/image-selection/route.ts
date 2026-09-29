import { z } from "zod"

import { replaceImageSelection } from "@/features/images/selection"
import { requireUser } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"

const schema = z.object({ imageIds: z.array(z.string().cuid()).min(1).max(10) })

async function PUTHandler(request: Request, context: RouteContext<"/api/projects/[projectId]/image-selection">) {
  const user = await requireUser()
  const { projectId } = await context.params
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Select between 1 and 10 images." }, { status: 400 })
  try {
    const selections = await replaceImageSelection(projectId, parsed.data.imageIds, user.id)
    return Response.json({ selections })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    return Response.json({ error: "Completed images not found." }, { status: 404 })
  }
}

export const PUT = route(PUTHandler)
