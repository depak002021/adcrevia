import { getPrisma } from "@/lib/db/prisma"
import { failUnfinishedVideo, refreshVideoStatus, VideoWorkflowError } from "@/features/videos/service"
import { registerHandler } from "../registry"
import { VIDEO_POLL_INTERVAL_MS } from "../constants"
import { PermanentJobError, RetryJobError } from "../types"

/**
 * Provider polling as durable work.
 *
 * The browser used to poll `/api/videos/:id/refresh` on a backoff, give up after
 * 120 attempts, and leave the row PROCESSING forever if the tab closed first. A
 * render that finished after the user navigated away was never collected.
 *
 * Here the queue is the poller: one attempt per job execution, and a
 * `RetryJobError` hands the scheduling decision back to the queue. That reuses
 * the existing backoff, lease recovery and attempt accounting instead of
 * reimplementing them, and the row is reconciled whether or not anyone is
 * watching.
 */

registerHandler("VIDEO_POLL", async (payload, { job, report, heartbeat }) => {
  const video = await getPrisma().generatedVideo.findFirst({
    where: { id: payload.videoId, project: { userId: payload.userId } },
    select: { status: true },
  })
  if (!video) throw new PermanentJobError("VIDEO_NOT_FOUND")

  // Already settled. Reaching here means a duplicate delivery or a late retry
  // after the render was collected, which is success, not failure.
  if (video.status === "COMPLETED" || video.status === "FAILED") {
    await report(100, video.status === "COMPLETED" ? "Render complete" : "Render stopped")
    return
  }

  await heartbeat()

  let result: Awaited<ReturnType<typeof refreshVideoStatus>>
  try {
    // The queue is where a 1080p Seedance render is re-encoded for the web.
    result = await refreshVideoStatus(payload.videoId, payload.userId, undefined, { worker: true })
  } catch (error) {
    if (error instanceof VideoWorkflowError) {
      // These describe a row that can never advance: no provider task recorded,
      // or the provider reported success with no output to download.
      if (error.code === "PROVIDER_TASK_REQUIRED" || error.code === "VIDEO_NOT_FOUND") {
        throw new PermanentJobError(error.code)
      }
      if (error.code === "PROVIDER_OUTPUT_REQUIRED" && job.attempts < job.maxAttempts) {
        // Worth one more look: the provider occasionally reports SUCCEEDED a
        // moment before the output URL is readable.
        throw new RetryJobError(VIDEO_POLL_INTERVAL_MS, error.code)
      }
    }
    // The last attempt: settle the video instead of leaving it PROCESSING forever.
    if (job.attempts >= job.maxAttempts) {
      await failUnfinishedVideo(payload.videoId, "VIDEO_STATUS_UNREADABLE").catch(() => {})
      throw new PermanentJobError("VIDEO_STATUS_UNREADABLE")
    }
    throw error
  }

  if (result.status === "COMPLETED") {
    await report(100, "Render complete")
    return
  }

  if (result.status === "FAILED") {
    // The provider rejected the render. The video row already records the safe
    // error code; surface the same code on the job so the two agree.
    throw new PermanentJobError(result.safeErrorCode ?? "VIDEO_PROVIDER_FAILED")
  }

  // Still running. Report whatever the provider gave us — several report nothing
  // useful, which is exactly why this is a pulse in the UI rather than a
  // fabricated percentage.
  await report(result.progress ?? 0, "Rendering motion")
  if (job.attempts >= job.maxAttempts) {
    await failUnfinishedVideo(payload.videoId, "VIDEO_TIMED_OUT")
    throw new PermanentJobError("VIDEO_TIMED_OUT")
  }
  throw new RetryJobError(VIDEO_POLL_INTERVAL_MS, "VIDEO_STILL_RENDERING")
})
