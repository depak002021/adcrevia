import { enqueue } from "./queue"
// Constants only. Importing a handler here would create a cycle back through
// features/videos/service and would register handlers as a side effect of
// merely scheduling work. See constants.ts.
import { VIDEO_POLL_INITIAL_DELAY_MS, VIDEO_POLL_MAX_ATTEMPTS } from "./constants"

/**
 * Typed entry points for scheduling work.
 *
 * Callers use these rather than `enqueue` directly, so the dedupe key, priority
 * and attempt budget for each kind live in one place. Those three values are
 * where a queue goes wrong — a missing dedupe key double-charges a provider, and
 * a priority chosen ad hoc lets a batch render starve the thing a user is
 * watching.
 *
 * Priority is LOWER-runs-first. The scale reflects who is waiting:
 *   20-49   a user is watching this happen right now
 *   50-99   a user asked for it and will come back
 *   100+    background and batch work
 */

const PRIORITY = {
  agentStep: 20,
  websiteScrape: 30,
  videoPoll: 40,
  imageGenerate: 50,
  imageEvaluate: 60,
  compose: 200,
  export: 210,
} as const

/**
 * Drive a project's image run to completion.
 *
 * Deduped per project: a second request while a run is outstanding joins the
 * existing job instead of starting a competing one. The orchestrator would
 * serialise them anyway, but two jobs would both hold leases and report
 * conflicting progress.
 */
export function scheduleImageRun(input: {
  projectId: string
  provider?: "openai" | "bfl" | "google"
  model?: string
}) {
  return enqueue({
    kind: "IMAGE_GENERATE",
    payload: {
      projectId: input.projectId,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
    },
    dedupeKey: `image-run:${input.projectId}`,
    projectId: input.projectId,
    priority: PRIORITY.imageGenerate,
    // A run is resumable and each frame has its own retry, so the job itself
    // rarely needs more than a couple of passes after a worker restart.
    maxAttempts: 3,
  })
}

export function scheduleImageEvaluation(projectId: string) {
  return enqueue({
    kind: "IMAGE_EVALUATE",
    payload: { projectId },
    dedupeKey: `image-eval:${projectId}`,
    projectId,
    priority: PRIORITY.imageEvaluate,
    maxAttempts: 3,
  })
}

/**
 * Reconcile a provider render until it settles.
 *
 * This is what makes a render survive the browser. The handler polls once and
 * throws `RetryJobError`, so the queue's own backoff and lease recovery do the
 * scheduling; `maxAttempts` is therefore the polling budget rather than an error
 * budget, which is why it is two orders of magnitude above the default.
 *
 * The first poll is delayed: no provider returns a finished render within a few
 * seconds, so an immediate attempt is a guaranteed wasted round trip.
 */
export function scheduleVideoPoll(input: { videoId: string; userId: string }) {
  return enqueue({
    kind: "VIDEO_POLL",
    payload: { videoId: input.videoId, userId: input.userId },
    dedupeKey: `video-poll:${input.videoId}`,
    priority: PRIORITY.videoPoll,
    maxAttempts: VIDEO_POLL_MAX_ATTEMPTS,
    delayMs: VIDEO_POLL_INITIAL_DELAY_MS,
  })
}

export function scheduleWebsiteScrape(input: { projectId: string; url: string }) {
  return enqueue({
    kind: "WEBSITE_SCRAPE",
    payload: { projectId: input.projectId, url: input.url },
    dedupeKey: `scrape:${input.projectId}:${input.url}`,
    projectId: input.projectId,
    priority: PRIORITY.websiteScrape,
    maxAttempts: 2,
  })
}

/**
 * Take one turn of the conversational brief.
 *
 * Deduped per conversation so two turns can never interleave — the agent re-reads the
 * whole transcript each time, and two concurrent steps would each reply to a
 * different half of it.
 *
 * `maxAttempts` is not purely an error budget as a result. A message that arrives
 * while a step is RUNNING joins this job rather than creating its own, so the handler
 * requeues itself to answer it. The allowance covers a short back-and-forth typed
 * faster than the agent can reply, plus room for a genuine retry.
 */
export function scheduleAgentStep(input: { conversationId: string; projectId: string; delayMs?: number }) {
  return enqueue({
    delayMs: input.delayMs,
    kind: "AGENT_STEP",
    payload: { conversationId: input.conversationId },
    dedupeKey: `agent-step:${input.conversationId}`,
    projectId: input.projectId,
    priority: PRIORITY.agentStep,
    maxAttempts: 6,
  })
}

export function scheduleComposition(input: { compositionId: string; projectId: string }) {
  return enqueue({
    kind: "VIDEO_COMPOSE",
    payload: { compositionId: input.compositionId },
    dedupeKey: `compose:${input.compositionId}`,
    projectId: input.projectId,
    priority: PRIORITY.compose,
    // ffmpeg failures are usually deterministic (a malformed source, an
    // impossible filter graph), so a long retry chain just burns CPU on a host
    // that has none to spare.
    maxAttempts: 2,
  })
}

export function scheduleExport(input: {
  compositionId: string
  preset: string
  projectId: string
}) {
  return enqueue({
    kind: "VIDEO_EXPORT",
    payload: { compositionId: input.compositionId, preset: input.preset },
    dedupeKey: `export:${input.compositionId}:${input.preset}`,
    projectId: input.projectId,
    priority: PRIORITY.export,
    maxAttempts: 2,
  })
}
