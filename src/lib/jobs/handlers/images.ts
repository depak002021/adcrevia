import { getPrisma } from "@/lib/db/prisma"
import { processNextImage, startImageRun } from "@/features/images/orchestrator"
import { createDirections } from "@/features/directions/service"
import { createImageProviderByName } from "@/lib/providers/runtime"
import { RECOMMENDED_IMAGE_CHOICE } from "@/lib/providers/recommended"
import { evaluateProjectImages } from "@/features/images/evaluation"
import { registerHandler } from "../registry"
import { PermanentJobError } from "../types"

/**
 * Image generation as durable work.
 *
 * Previously this was a `for` loop in the browser firing one request per image:
 * closing the tab halted the run, and a five-minute provider poll inside a
 * request was racing the platform's own timeout.
 *
 * One job drives an entire run rather than one image. The orchestrator already
 * serialises to a single in-flight image per project and each image row carries
 * its own status and idempotency key, so this loop is resumable: if the worker
 * dies, the lease expires, the job is requeued, and it continues from whichever
 * images are still PENDING. That is also why it is safe under at-least-once
 * delivery — a duplicate execution finds nothing left to claim.
 */
registerHandler("IMAGE_GENERATE", async (payload, { job, report, heartbeat, signal }) => {
  const db = getPrisma()

  const project = await db.project.findUnique({
    where: { id: payload.projectId },
    select: { targetImageCount: true },
  })
  if (!project) throw new PermanentJobError("PROJECT_NOT_FOUND")

  // The run is created if it does not exist yet. `createPendingImages` uses
  // `skipDuplicates`, so calling it on a resumed job is a no-op.
  const owner = await db.project.findUnique({
    where: { id: payload.projectId },
    select: { userId: true },
  })
  if (!owner) throw new PermanentJobError("PROJECT_NOT_FOUND")

  // Generate pressed before the conversation drafted a shot list: plan it now from
  // everything known (one text call), rather than refusing.
  const directions = await db.creativeDirection.count({ where: { projectId: payload.projectId } })
  if (directions !== project.targetImageCount) {
    await report(2, "Planning the shots from your brief")
    await heartbeat()
    await createDirections(payload.projectId, owner.userId)
  }
  // A concept row for every shot that has none yet: all of them on a first run, and
  // the re-planned ones after the shot list was refreshed around finished images.
  // Idempotent: existing rows are skipped.
  const existing = await db.generatedImage.count({ where: { projectId: payload.projectId } })
  if (existing < project.targetImageCount) await startImageRun(payload.projectId, owner.userId)

  const total = project.targetImageCount
  // No model picked (a run started from the conversation): use the recommended one
  // when Google is configured, rather than whichever provider happens to be active.
  let choice: { provider: "openai" | "bfl" | "google"; model?: string } | undefined = payload.provider
    ? { provider: payload.provider, model: payload.model }
    : (await createImageProviderByName(RECOMMENDED_IMAGE_CHOICE.provider, RECOMMENDED_IMAGE_CHOICE.model).then(() => RECOMMENDED_IMAGE_CHOICE).catch(() => undefined))

  // Bounded rather than `while (true)`: the orchestrator retries a failed image
  // only when asked to, so the natural ceiling is one pass per image plus a
  // margin. An unbounded loop here could hold a lease indefinitely if a status
  // ever failed to advance.
  const maxPasses = total * 2 + 2

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (signal.aborted) return

    const remaining = await db.generatedImage.count({
      where: { projectId: payload.projectId, status: { in: ["PENDING", "GENERATING"] } },
    })
    if (remaining === 0) break

    const completed = await db.generatedImage.count({
      where: { projectId: payload.projectId, status: "COMPLETED" },
    })

    // Progress is the real count of finished frames, not a timer. The label names
    // the scene being painted so the waiting state says something true.
    await report(
      Math.round((completed / total) * 100),
      `Painting scene ${Math.min(completed + 1, total)} of ${total}`,
    )

    // A single image can take minutes: FLUX polls for up to 240 seconds inside
    // the provider call. Renew the lease before each one so a slow frame is not
    // mistaken for a dead worker.
    await heartbeat()

    // After FLUX refuses a shot, the rest of this run goes straight to the fallback
    // model rather than paying FLUX for more refusals.
    await processNextImage(payload.projectId, undefined, choice, {
      onFallback: (next) => {
        choice = next
      },
    })
  }

  const completed = await db.generatedImage.count({
    where: { projectId: payload.projectId, status: "COMPLETED" },
  })

  // Every frame failing is a real failure of the job, not a quiet success. The
  // project row has already been settled to FAILED by the orchestrator; this
  // makes the job row agree with it.
  if (completed === 0) throw new PermanentJobError("ALL_IMAGES_FAILED")

  await report(100, completed === total ? "All scenes ready" : `${completed} of ${total} scenes ready`)
})

/**
 * Scoring the finished frames.
 *
 * Kept as its own job because it is a single expensive call over every image at
 * high detail, and because it is worth retrying independently: a failed
 * evaluation should not invalidate a successful generation run.
 */
registerHandler("IMAGE_EVALUATE", async (payload, { report }) => {
  await report(10, "Studying every concept")
  try {
    await evaluateProjectImages(payload.projectId)
  } catch (error) {
    // Not enough completed frames yet. Retrying cannot help — the run has already
    // settled — so fail permanently with a code the UI can explain.
    if (error instanceof Error && error.message === "TARGET_COMPLETED_IMAGES_REQUIRED") {
      throw new PermanentJobError("EVALUATION_NEEDS_COMPLETE_RUN")
    }
    throw error
  }
  await report(100, "Evaluation complete")
})
