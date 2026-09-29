import { readBriefTranscript, type BriefTranscript } from "@/features/brief/transcript"
import { getPrisma } from "@/lib/db/prisma"
import type { CompositionStatus, JobKind, JobStatus, ProjectStatus } from "@/generated/prisma/enums"

/**
 * The single source of truth for "what is happening to this project right now".
 *
 * Read by the initial server render and by the event stream, so the page cannot
 * disagree with the stream about what it is showing. Previously the client
 * derived its own view: it guessed which scene was being painted from a loop
 * counter, recomputed the AI recommendation by re-sorting scores, and drove a
 * progress bar from `setInterval`. All three could contradict the database.
 *
 * `activity` in particular is computed HERE. The waiting state is the part of
 * this product a user spends the most time looking at, and it has to be true.
 */

export type ImageSnapshot = {
  id: string
  position: number
  status: "PENDING" | "GENERATING" | "COMPLETED" | "FAILED"
  url: string | null
  safeErrorCode: string | null
  evaluation: {
    score: number
    reasoning: string
    strengths: unknown
    recommended: boolean
    /**
     * Per-axis breakdown, 0-100. Null per axis when the provider that evaluated
     * this image did not score it, which is why each one is individually nullable
     * rather than the whole object being absent.
     */
    axes: {
      promptAlignment: number | null
      productConsistency: number | null
      brandAlignment: number | null
      composition: number | null
      visualQuality: number | null
      commercialSuitability: number | null
    }
  } | null
}

export type VideoSnapshot = {
  id: string
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  url: string | null
  /** The frame the clip was rendered from: a still thumbnail (the url is an MP4). */
  posterUrl: string | null
  aspectRatio: string | null
  durationSeconds: number | null
  safeErrorCode: string | null
  /** Which model renders it, for the time estimate. */
  model?: string | null
}

export type JobSnapshot = {
  id: string
  kind: JobKind
  status: JobStatus
  progress: number
  progressLabel: string | null
  safeErrorCode: string | null
  attempts: number
  maxAttempts: number
  startedAt?: Date | string | null
}

/** What the UI shows while work is in flight. Derived, never invented. */
export type ActivitySnapshot = {
  /** Human-readable, from the job's own progress label where available. */
  label: string
  /** 0-100. Real completion, not elapsed time. */
  progress: number
  /** Distinguishes "we know how far along" from "we only know it is running". */
  determinate: boolean
  kind: JobKind
  /** When the running job started (ISO), so countdowns survive a reload. */
  startedAt?: string | null
}

export type ProjectSnapshot = {
  id: string
  status: ProjectStatus
  targetImageCount: number
  /** Frame shape chosen for this project's images; null = legacy 3:2. */
  imageFormat: string | null
  images: ImageSnapshot[]
  selectedImageIds: string[]
  videos: VideoSnapshot[]
  jobs: JobSnapshot[]
  activity: ActivitySnapshot | null
  /**
   * The brief conversation, when the project has one.
   *
   * Carried on the snapshot so the transcript arrives over the same stream as
   * everything else. The agent replies from a worker, so there is no response to a
   * request to put the reply in — without this the user would send a message and
   * then have to poll to find out what was said back.
   */
  brief: BriefTranscript | null
  /**
   * Edits on this project, newest first.
   *
   * Only the parts the timeline needs to stay live: status, poster, duration and per
   * destination progress. The clip arrangement is fetched on demand, because it does
   * not change while a render is running and the snapshot is re-read every second.
   */
  compositions: CompositionSnapshot[]
  /** True while any job is queued or running, so the stream knows to stay open. */
  busy: boolean
}

export type CompositionSnapshot = {
  id: string
  status: CompositionStatus
  aspectRatio: string
  durationMs: number | null
  url: string | null
  posterUrl: string | null
  safeErrorCode: string | null
  clipCount: number
  renders: Array<{
    id: string
    preset: string
    status: CompositionStatus
    url: string | null
    bytes: number | null
    safeErrorCode: string | null
  }>
}

/** Jobs that are still going to do something. */
const LIVE_JOB_STATUSES: JobStatus[] = ["QUEUED", "RUNNING"]

export async function readProjectSnapshot(
  projectId: string,
  userId: string,
): Promise<ProjectSnapshot | null> {
  const db = getPrisma()

  const project = await db.project.findFirst({
    where: { id: projectId, userId },
    select: {
      id: true,
      status: true,
      targetImageCount: true,
      imageFormat: true,
      images: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          status: true,
          url: true,
          safeErrorCode: true,
          evaluation: {
            select: {
              score: true,
              reasoning: true,
              strengths: true,
              recommended: true,
              promptAlignment: true,
              productConsistency: true,
              brandAlignment: true,
              composition: true,
              visualQuality: true,
              commercialSuitability: true,
            },
          },
        },
      },
      imageSelections: { orderBy: { position: "asc" }, select: { imageId: true } },
      videos: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          url: true,
          aspectRatio: true,
          durationSeconds: true,
          safeErrorCode: true,
          model: true,
          sourceImage: { select: { url: true } },
        },
      },
      jobs: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          status: true,
          progress: true,
          progressLabel: true,
          safeErrorCode: true,
          attempts: true,
          maxAttempts: true,
          startedAt: true,
        },
      },
      compositions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          aspectRatio: true,
          durationMs: true,
          url: true,
          posterUrl: true,
          safeErrorCode: true,
          _count: { select: { clips: true } },
          renders: {
            orderBy: { createdAt: "asc" },
            select: { id: true, preset: true, status: true, url: true, bytes: true, safeErrorCode: true },
          },
        },
      },
    },
  })

  if (!project) return null

  const jobs: JobSnapshot[] = project.jobs
  const liveJobs = jobs.filter((job) => LIVE_JOB_STATUSES.includes(job.status))

  // Read after the ownership check above, so this never runs for a project the
  // caller cannot see.
  const brief = await readBriefTranscript(projectId)

  return {
    id: project.id,
    status: project.status,
    targetImageCount: project.targetImageCount,
    imageFormat: project.imageFormat,
    images: project.images.map((image) => ({
      id: image.id,
      position: image.position,
      status: image.status,
      url: image.url,
      safeErrorCode: image.safeErrorCode,
      evaluation: image.evaluation
        ? {
            score: image.evaluation.score,
            reasoning: image.evaluation.reasoning,
            strengths: image.evaluation.strengths,
            recommended: image.evaluation.recommended,
            axes: {
              promptAlignment: image.evaluation.promptAlignment,
              productConsistency: image.evaluation.productConsistency,
              brandAlignment: image.evaluation.brandAlignment,
              composition: image.evaluation.composition,
              visualQuality: image.evaluation.visualQuality,
              commercialSuitability: image.evaluation.commercialSuitability,
            },
          }
        : null,
    })),
    selectedImageIds: project.imageSelections.map((selection) => selection.imageId),
    videos: project.videos.map(({ sourceImage, ...video }) => ({ ...video, posterUrl: sourceImage?.url ?? null })),
    jobs,
    activity: deriveActivity(liveJobs),
    brief,
    compositions: project.compositions.map(({ _count, ...composition }) => ({
      ...composition,
      clipCount: _count.clips,
    })),
    busy: liveJobs.length > 0,
  }
}

/**
 * Pick the one thing worth telling the user about.
 *
 * Several jobs can be live at once (a render reconciling while an evaluation
 * queues). Showing all of them is noise, so the most user-relevant one wins:
 * whatever is actually RUNNING, falling back to the next queued item so the UI
 * still says something during the gap before a worker picks it up.
 */
function deriveActivity(liveJobs: JobSnapshot[]): ActivitySnapshot | null {
  if (liveJobs.length === 0) return null

  const running = liveJobs.find((job) => job.status === "RUNNING")
  const job = running ?? liveJobs[0]

  if (job.status === "QUEUED") {
    return {
      label: QUEUED_LABELS[job.kind],
      progress: 0,
      // Nothing has started, so any number would be a guess.
      determinate: false,
      kind: job.kind,
    }
  }

  return {
    // The worker writes a specific label ("Painting scene 2 of 4"); the generic
    // fallback only applies before the first report lands.
    label: job.progressLabel ?? RUNNING_LABELS[job.kind],
    progress: job.progress,
    // Zero means the handler has not reported yet, which is not the same as
    // "0% complete" — treat it as indeterminate so the bar pulses rather than
    // sitting empty.
    determinate: job.progress > 0,
    kind: job.kind,
    startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
  }
}

const QUEUED_LABELS: Record<JobKind, string> = {
  IMAGE_GENERATE: "Queued for the image studio",
  IMAGE_EVALUATE: "Queued for review",
  VIDEO_SUBMIT: "Queued for the motion studio",
  VIDEO_POLL: "Waiting on the render",
  VIDEO_COMPOSE: "Queued for the edit",
  VIDEO_EXPORT: "Queued for export",
  WEBSITE_SCRAPE: "Queued to read the site",
  AGENT_STEP: "Thinking",
}

const RUNNING_LABELS: Record<JobKind, string> = {
  IMAGE_GENERATE: "Painting the scenes",
  IMAGE_EVALUATE: "Reviewing every concept",
  VIDEO_SUBMIT: "Sending to the motion studio",
  VIDEO_POLL: "Rendering motion",
  VIDEO_COMPOSE: "Cutting the edit",
  VIDEO_EXPORT: "Encoding for each platform",
  WEBSITE_SCRAPE: "Reading the site",
  AGENT_STEP: "Thinking",
}
