"use client"

import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkle } from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"
import { Eyebrow } from "@/components/ui/eyebrow"
import { Progress, ProgressPulse } from "@/components/ui/progress"
import { WhileYouWait } from "@/components/ui/while-you-wait"
import { useExpectedTimes } from "@/components/ui/use-expected-times"
import { expectedImageMs, expectedVideoMs } from "@/features/timing/expected"
import { RECOMMENDED_IMAGE_MODEL } from "@/lib/providers/recommended"
import { FormatSelector } from "@/components/ui/format-selector"
import { ProductPhotos } from "@/components/generation/product-photos"
import { asImageFormat, type ImageFormat } from "@/lib/providers/images/formats"
import { estimateImageUsd } from "@/lib/costs/pricing"
import { ModelSelector, type ModelSelection } from "@/components/ui/model-selector"
import { useToast } from "@/components/ui/toast"
import { BriefConversation } from "@/components/brief/brief-conversation"
import { CaptionsPanel } from "@/components/captions/captions-panel"
import { ProjectSpend } from "@/components/costs/project-spend"
import type { SpendSummary } from "@/features/costs/summary"
import { CompositionStudio } from "@/components/compositions/composition-studio"
import { ImageConceptCard } from "@/components/images/image-concept-card"
import { ImagePreviewModal } from "@/components/images/image-preview-modal"
import { ImageSelectionTray } from "@/components/images/image-selection-tray"
import { useProjectStream } from "@/features/projects/use-project-stream"
import type { ImageSnapshot, ProjectSnapshot } from "@/features/projects/snapshot"
import type { JobKind } from "@/generated/prisma/enums"

/** Matches the server-side cap in `replaceImageSelection`. */
const MAX_SELECTION = 10

/**
 * Job kinds that have their own status line further down the page.
 *
 * The brief narrates its own thinking and the edit narrates its own encoding. Showing
 * the same label in the banner as well reads as two separate things happening.
 */
const NARRATED_ELSEWHERE = new Set<JobKind>(["AGENT_STEP", "VIDEO_COMPOSE", "VIDEO_EXPORT"])

/**
 * The image studio.
 *
 * Rewritten around the project event stream. What it no longer does:
 *
 *   - run a `for` loop firing one generation request per image, which stopped the
 *     moment the tab closed
 *   - advance a progress bar on a `setInterval`, so the screen could claim work
 *     was happening when nothing was
 *   - guess the current scene from a loop counter
 *   - recompute the AI recommendation client-side by re-sorting scores, which
 *     could disagree with the server
 *
 * It now enqueues, opens the stream, and renders whatever the database says.
 * Every number on screen is a real one.
 */
export function ProjectWorkspace({ initial, initialSpend }: { initial: ProjectSnapshot; initialSpend?: SpendSummary | null }) {
  const { snapshot, watch } = useProjectStream(initial.id, initial)
  const toast = useToast()
  const router = useRouter()
  const times = useExpectedTimes()

  const [preview, setPreview] = useState<ImageSnapshot | null>(null)
  const [imageChoice, setImageChoice] = useState<ModelSelection | null>(null)
  // Vertical by default: concepts usually become Reels/TikTok/Shorts.
  const [format, setFormat] = useState<ImageFormat>(asImageFormat(snapshot.imageFormat ?? "9:16"))
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)

  // Selection is the one piece of genuinely local state: it is a draft until
  // saved, so it must not be overwritten by every incoming frame.
  const [draftSelection, setDraftSelection] = useState<string[] | null>(null)
  const selectedImageIds = draftSelection ?? snapshot.selectedImageIds
  const orderSaved = draftSelection === null && snapshot.selectedImageIds.length > 0

  const { images, targetImageCount, activity, busy } = snapshot

  const completed = useMemo(() => images.filter((i) => i.status === "COMPLETED"), [images])
  const evaluated = images.some((image) => image.evaluation)
  const hasUnstarted = images.length === 0
  const canGenerate = hasUnstarted || images.some((i) => i.status === "PENDING" || i.status === "FAILED")

  // What the next run will cost, before anything is sent: the list price per image
  // for the chosen model and shape, times the images still to make. The actual
  // (from the provider's own figures) is recorded per image once it renders.
  const toGenerate = hasUnstarted ? targetImageCount : images.filter((i) => i.status === "PENDING" || i.status === "FAILED").length
  const perImage = imageChoice ? estimateImageUsd(imageChoice.provider, imageChoice.model, hasUnstarted ? format : asImageFormat(snapshot.imageFormat ?? format)) : null
  const runEstimate = perImage === null ? null : perImage * toGenerate

  /**
   * Tiles are keyed off the expected scene count, not the rows that exist yet, so
   * the grid has its final shape before generation starts. That keeps the layout
   * from jumping as rows appear.
   */
  const tiles = useMemo(
    () =>
      Array.from({ length: targetImageCount }, (_, index) => {
        const position = index + 1
        return (
          images.find((image) => image.position === position) ?? {
            id: `placeholder-${position}`,
            position,
            status: "PENDING" as const,
            url: null,
            safeErrorCode: null,
            evaluation: null,
          }
        )
      }),
    [images, targetImageCount],
  )

  async function post(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(payload.error ?? "That did not go through.")
    return payload
  }

  async function run(action: string, work: () => Promise<unknown>) {
    setPendingAction(action)
    try {
      await work()
      // Open the stream straight after enqueueing so the first worker progress
      // frame is already being listened for.
      watch()
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not start",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setPendingAction(null)
    }
  }

  const generate = () =>
    run("generate", () =>
      post("/api/images/generate", {
        projectId: snapshot.id,
        action: images.length ? "next" : "start",
        ...(imageChoice ? { provider: imageChoice.provider, model: imageChoice.model } : {}),
        // Chosen once, for the whole run; continuing keeps the project's saved shape.
        ...(images.length ? {} : { format }),
      }),
    )

  const evaluate = () =>
    run("evaluate", () => post("/api/ai/evaluate-images", { projectId: snapshot.id }))

  const retry = (imageId: string) =>
    run(`retry:${imageId}`, async () => {
      await post(`/api/images/${imageId}/retry`)
      await post("/api/images/generate", { projectId: snapshot.id, action: "next" })
    })

  function toggleSelection(imageId: string) {
    setDraftSelection((current) => {
      const base = current ?? snapshot.selectedImageIds
      if (base.includes(imageId)) return base.filter((id) => id !== imageId)
      if (base.length >= MAX_SELECTION) {
        toast({
          tone: "info",
          title: `That is the maximum`,
          description: `A video can weave up to ${MAX_SELECTION} scenes.`,
        })
        return base
      }
      return [...base, imageId]
    })
  }

  /**
   * The next step once the concepts are in. With nothing picked, every finished
   * concept goes into the video in shot order (the shot list was planned as the
   * reel's scenes); a saved or drafted selection is used as it is.
   */
  async function makeVideo() {
    const chosen = selectedImageIds.length
      ? selectedImageIds
      : [...completed].sort((a, b) => a.position - b.position).map((image) => image.id).slice(0, MAX_SELECTION)
    setPendingAction("video")
    try {
      if (!orderSaved || draftSelection !== null) {
        const response = await fetch(`/api/projects/${snapshot.id}/image-selection`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageIds: chosen }),
        })
        if (!response.ok) throw new Error("We could not save the scene order.")
        setDraftSelection(null)
      }
      router.push(`/dashboard/create/video?project=${snapshot.id}`)
    } catch (error) {
      setPendingAction(null)
      toast({ tone: "error", title: "Could not continue", description: error instanceof Error ? error.message : undefined })
    }
  }

  async function saveOrder(imageIds: string[]) {
    if (imageIds.length === 0) return
    setSavingOrder(true)
    try {
      const response = await fetch(`/api/projects/${snapshot.id}/image-selection`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageIds }),
      })
      if (!response.ok) throw new Error("We could not save that order.")
      // Hand control back to the server's copy now that it matches.
      setDraftSelection(null)
      toast({ tone: "success", title: "Running order saved" })
    } catch (error) {
      toast({
        tone: "error",
        title: "Order not saved",
        description: error instanceof Error ? error.message : undefined,
        // The draft is deliberately kept so the arrangement is not lost.
      })
    } finally {
      setSavingOrder(false)
    }
  }

  // How many images this run set out to make, fixed when it starts. Counting only
  // the ones still waiting shrank the estimate as images finished while the clock
  // kept running, so a healthy run claimed to be "taking longer than usual".
  const waiting = images.filter((image) => image.status === "PENDING" || image.status === "GENERATING").length
  const runKey = activity?.kind === "IMAGE_GENERATE" ? activity.startedAt ?? "run" : null
  const runSizes = useRef(new Map<string, number>())
  if (runKey) runSizes.current.set(runKey, Math.max(runSizes.current.get(runKey) ?? 0, waiting || targetImageCount))
  const runSize = (runKey && runSizes.current.get(runKey)) || 1

  // Re-read the spend whenever a render settles.
  const spendKey = [
    snapshot.images.filter((image) => image.status === "COMPLETED" || image.status === "FAILED").length,
    snapshot.videos.filter((video) => video.status === "COMPLETED" || video.status === "FAILED").length,
  ].join("-")

  return (
    <>
      {initialSpend ? <ProjectSpend projectId={snapshot.id} initial={initialSpend} refreshKey={spendKey} /> : null}
      {/*
        The brief lives here rather than on its own page, and reads from this
        component's stream rather than opening a second one. Two EventSource
        connections per tab is not something to spend on a host with a small
        connection budget, and the conversation and the concepts have to agree
        about the project anyway.
      */}
      <BriefConversation
        projectId={snapshot.id}
        brief={snapshot.brief}
        activity={activity}
        onSent={watch}
      />

      <ProductPhotos
        projectId={snapshot.id}
        disabled={busy}
        refreshKey={`${snapshot.brief?.knows.website?.analyzed ?? ""}-${snapshot.brief?.knows.website?.photos ?? 0}`}
      />

      <section id="concepts" className="mt-10 flex scroll-mt-6 flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Concepts</Eyebrow>
          <h2 className="mt-2 text-[1.5rem] leading-tight font-medium tracking-[-0.03em] text-fg">
            {completed.length === targetImageCount
              ? "Every concept is ready."
              : `${targetImageCount} concepts, generated one at a time.`}
          </h2>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {canGenerate ? (
            <>
              <ModelSelector
                endpoint="/api/images/models"
                recommended={RECOMMENDED_IMAGE_MODEL}
                label="Image model"
                value={imageChoice}
                onChange={setImageChoice}
                disabled={busy}
              />
              {images.length === 0 ? (
                <FormatSelector value={format} onChange={setFormat} disabled={busy} />
              ) : null}
              <Button
                variant="primary"
                well
                glyph="right"
                busy={pendingAction === "generate"}
                disabled={busy || !imageChoice}
                onClick={generate}
                leading={<Sparkle size={15} weight="fill" aria-hidden="true" />}
              >
                {images.length ? "Continue" : `Generate ${targetImageCount}`}
                {runEstimate !== null ? ` · ≈ $${runEstimate.toFixed(2)}` : ""}
              </Button>
              {perImage !== null ? (
                <p className="w-full text-right text-[0.78rem] text-muted" aria-live="polite">
                  ≈ ${perImage.toFixed(3)} per image × {toGenerate}. Charged only for images that render.
                  {hasUnstarted && !snapshot.brief?.knows.directions.length ? " The shots are planned from your brief first." : ""}
                </p>
              ) : null}
            </>
          ) : completed.length > 0 ? (
            <>
              {!evaluated && completed.length > 1 ? (
                <Button busy={pendingAction === "evaluate"} disabled={busy} onClick={evaluate}>
                  AI review
                </Button>
              ) : null}
              <Button
                variant="primary"
                well
                glyph="right"
                busy={pendingAction === "video"}
                disabled={busy}
                onClick={makeVideo}
              >
                {selectedImageIds.length ? `Make the video · ${selectedImageIds.length} scene${selectedImageIds.length === 1 ? "" : "s"}` : "Make the video"}
              </Button>
              <p className="w-full text-right text-[0.78rem] text-muted">
                {selectedImageIds.length ? "Uses the scenes you picked, in that order." : "Uses every concept in shot order. Tap concepts to pick and reorder."}
              </p>
            </>
          ) : null}
        </div>
      </section>

      {/*
        One honest status line, driven by the worker's own progress. Agent turns are
        excluded: the conversation above already narrates them, and the same label in
        two places reads as two things happening.
      */}
      {activity && !NARRATED_ELSEWHERE.has(activity.kind) ? (
        <section
          className="mt-6 flex flex-col gap-2.5 rounded-inner bg-accent/5 px-4 py-3.5 shadow-[inset_0_0_0_1px_--alpha(var(--color-accent)/18%)]"
          aria-live="polite"
        >
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[0.88rem] text-fg">{activity.label}</span>
            {activity.determinate ? (
              <span className="font-mono text-[0.75rem] tabular-nums text-muted">
                {activity.progress}%
              </span>
            ) : null}
          </div>
          {activity.determinate ? (
            <Progress value={activity.progress} label={activity.label} />
          ) : (
            <ProgressPulse label={activity.label} />
          )}
          {activity.kind === "IMAGE_GENERATE" ? (
            <WhileYouWait
              expectedMs={expectedImageMs(times, imageChoice?.model) * runSize}
              startedAt={activity.startedAt ? Date.parse(activity.startedAt) : undefined}
            />
          ) : activity.kind === "VIDEO_SUBMIT" || activity.kind === "VIDEO_POLL" ? (
            <WhileYouWait
              expectedMs={expectedVideoMs(times, snapshot.videos.find((video) => video.status === "PROCESSING" || video.status === "PENDING")?.model)}
              startedAt={activity.startedAt ? Date.parse(activity.startedAt) : undefined}
            />
          ) : null}
        </section>
      ) : null}

      <section
        className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-label="Generated concepts"
        aria-busy={busy || undefined}
      >
        {tiles.map((image) => {
          const order = selectedImageIds.indexOf(image.id)
          return (
            <ImageConceptCard
              key={image.id}
              image={image}
              selectedOrder={order >= 0 ? order + 1 : null}
              onToggle={() => toggleSelection(image.id)}
              onPreview={() => setPreview(image)}
              onRetry={() => retry(image.id)}
              disabled={busy}
              format={snapshot.imageFormat ?? format}
            />
          )
        })}
      </section>

      {/*
        The edit sits below the concepts because that is the order the work happens in,
        and it reads from this component's stream rather than opening a second one.
      */}
      <div className="mt-10">
        <CompositionStudio
          projectId={snapshot.id}
          videos={snapshot.videos}
          compositions={snapshot.compositions}
          activity={activity}
          onQueued={watch}
        />
      </div>

      {completed.length > 0 ? <CaptionsPanel projectId={snapshot.id} /> : null}

      <ImageSelectionTray
        items={images.map(({ id, position, url }) => ({ id, position, url }))}
        imageIds={selectedImageIds}
        maxSelection={MAX_SELECTION}
        onChange={setDraftSelection}
        onSave={saveOrder}
        saving={savingOrder}
      />

      <ImagePreviewModal image={preview} onClose={() => setPreview(null)} />
    </>
  )
}
