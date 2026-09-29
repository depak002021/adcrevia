import { getPrisma } from "@/lib/db/prisma"
import {
  isPermanentComposeCode,
  renderCompositionExport,
  renderCompositionMaster,
  safeComposeCode,
} from "@/lib/video/compose"

import { registerHandler } from "../registry"
import { PermanentJobError } from "../types"

/**
 * Encoding, as durable work.
 *
 * A composition render is minutes of CPU. It cannot live in a request, and it cannot
 * be lost when a worker restarts mid-encode — which is why the failure path matters as
 * much as the success path here. Both handlers write the outcome to the row they own
 * before rethrowing, so a user who comes back to the page sees why it failed rather
 * than a composition stuck at RENDERING forever.
 *
 * `FAILED` is a real state that the UI can offer a retry from. The previous video flow
 * had a terminal status that nothing ever set, so a failed render was
 * indistinguishable from one still in progress.
 */

registerHandler("VIDEO_COMPOSE", async (payload, { report, heartbeat, signal }) => {
  try {
    await renderCompositionMaster({
      compositionId: payload.compositionId,
      report,
      heartbeat,
      signal,
    })
  } catch (error) {
    const safeErrorCode = safeComposeCode(error)

    // Best-effort. The job failure below is the authoritative signal, but without
    // this the row stays at RENDERING and the page shows a render that will never
    // finish.
    await getPrisma()
      .videoComposition.updateMany({
        where: { id: payload.compositionId },
        data: { status: "FAILED", safeErrorCode },
      })
      .catch(() => {})

    if (isPermanentComposeCode(safeErrorCode)) throw new PermanentJobError(safeErrorCode)
    throw error
  }
})

registerHandler("VIDEO_EXPORT", async (payload, { report, heartbeat, signal }) => {
  try {
    await renderCompositionExport({
      compositionId: payload.compositionId,
      preset: payload.preset,
      report,
      heartbeat,
      signal,
    })
  } catch (error) {
    const safeErrorCode = safeComposeCode(error)

    // Scoped to the one preset. A TikTok export failing must not mark the Reels
    // export, or the master, as broken.
    await getPrisma()
      .compositionRender.updateMany({
        where: { compositionId: payload.compositionId, preset: payload.preset },
        data: { status: "FAILED", safeErrorCode },
      })
      .catch(() => {})

    if (isPermanentComposeCode(safeErrorCode)) throw new PermanentJobError(safeErrorCode)
    throw error
  }
})
