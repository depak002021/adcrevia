import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"

/**
 * The creative directions the agent proposed.
 *
 * Fetched on demand rather than carried on the project snapshot: the full text of
 * every direction is several kilobytes, and the snapshot is re-read once a second
 * while work is in flight. The brief panel shows titles from the snapshot and pulls
 * this only when the user opens the detail sheet.
 *
 * Params are typed explicitly rather than via `RouteContext<...>`: that helper reads
 * from Next's generated route registry, which does not contain a route until a build
 * has run.
 */

async function GETHandler(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await requireUser()
  const { projectId } = await context.params

  const project = await getPrisma().project.findFirst({
    where: { id: projectId, userId: user.id },
    select: {
      directions: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          title: true,
          description: true,
          environment: true,
          lighting: true,
          composition: true,
          camera: true,
          mood: true,
          colorTreatment: true,
        },
      },
    },
  })
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 })

  // `imagePrompt` is deliberately omitted. It is the instruction sent to the image
  // model, not information about the campaign, and showing it invites editing a
  // field that has a validated shape.
  return Response.json({ directions: project.directions })
}

export const GET = route(GETHandler)
