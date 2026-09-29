import { z } from "zod"

import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"
import { scheduleImageEvaluation } from "@/lib/jobs/schedule"

/**
 * Queue a review pass over the finished frames.
 *
 * Evaluation sends every image to the model at high detail, so it was the
 * slowest blocking route in the app and had no `maxDuration` set at all. It is
 * now a job, and the client watches the project event stream for the result.
 */

const schema = z.object({ projectId: z.string().cuid() })

async function POSTHandler(request: Request) {
  const user = await requireUser()

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid project." }, { status: 400 })

  const project = await getPrisma().project.findFirst({
    where: { id: parsed.data.projectId, userId: user.id },
    select: {
      id: true,
      targetImageCount: true,
      _count: { select: { images: { where: { status: "COMPLETED" } } } },
    },
  })
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 })

  // The evaluator needs the full set, so refusing up front is clearer than
  // enqueueing work that is guaranteed to fail.
  if (project._count.images !== project.targetImageCount) {
    return Response.json(
      {
        error: "Every concept has to finish before they can be reviewed together.",
        code: "EVALUATION_NEEDS_COMPLETE_RUN",
      },
      { status: 409 },
    )
  }

  const job = await scheduleImageEvaluation(project.id)

  return Response.json(
    { job: { id: job.id, status: job.status, kind: job.kind } },
    { status: 202 },
  )
}

export const POST = route(POSTHandler)
