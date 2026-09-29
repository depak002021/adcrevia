import { z } from "zod"

import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"
import { scheduleImageRun } from "@/lib/jobs/schedule"
import { IMAGE_FORMATS } from "@/lib/providers/images/formats"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/**
 * Start (or resume) an image run.
 *
 * This used to generate an image inline: one provider call per request, with FLUX
 * polling for up to 240 seconds inside the handler, driven by a `for` loop in the
 * browser. Closing the tab halted the run, and the route needed `maxDuration =
 * 300` to survive its own slowest path.
 *
 * Now it enqueues and returns immediately. The worker owns the generation and the
 * client watches `/api/projects/:id/events`. That is what makes a run survive a
 * closed tab, and it is why there is no longer a provider error taxonomy here —
 * provider failures land on the image row and the job row, where the stream can
 * surface them.
 */

const schema = z.object({
  projectId: z.string().cuid(),
  /**
   * Retained for compatibility with the previous contract. The run is resumable
   * either way, so start and next are now the same request.
   */
  action: z.enum(["start", "next"]).default("start"),
  provider: z.enum(["openai", "bfl", "google"]).optional(),
  model: z.string().max(100).optional(),
  /** Frame shape; stored on the project so retries and the video step follow it. */
  format: z.enum(IMAGE_FORMATS).optional(),
})

async function POSTHandler(request: Request) {
  const user = await requireUser()

  // Still rate limited, but now it guards enqueueing rather than a provider
  // call, so the window can be generous.
  const limit = await rateLimiter.check({
    action: "image-generation",
    identifier: user.id,
    limit: 12,
    windowSeconds: 60,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid image run request." }, { status: 400 })

  const project = await getPrisma().project.findFirst({
    where: { id: parsed.data.projectId, userId: user.id },
    select: {
      id: true,
      targetImageCount: true,
    },
  })
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 })

  // No shot list yet is fine: the job plans one from the brief before shooting.

  if (parsed.data.format) {
    await getPrisma().project.update({ where: { id: project.id }, data: { imageFormat: parsed.data.format } })
  }

  // Continue after a failure: the failed concepts go back in the queue so they are
  // retried (with the model chosen now). Without this the run found nothing to do
  // and stopped at once, so switching models after a failure never called them.
  if (parsed.data.action === "next") {
    await getPrisma().generatedImage.updateMany({
      where: { projectId: project.id, status: "FAILED" },
      data: { status: "PENDING", safeErrorCode: null, leaseExpiresAt: null },
    })
  }

  const job = await scheduleImageRun({
    projectId: project.id,
    provider: parsed.data.provider,
    model: parsed.data.model,
  })

  return Response.json(
    { job: { id: job.id, status: job.status, kind: job.kind } },
    { status: 202 },
  )
}

export const POST = route(POSTHandler)
