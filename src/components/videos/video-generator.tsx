"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { Film, Sparkles, Wand2 } from "lucide-react"

import { VideoPlayer } from "./video-player"
import { WhileYouWait } from "@/components/ui/while-you-wait"
import { useExpectedTimes } from "@/components/ui/use-expected-times"
import { expectedReelMs, expectedVideoMs } from "@/features/timing/expected"
import { RECOMMENDED_VIDEO_MODEL } from "@/lib/providers/recommended"
import { VideoProgress } from "./video-progress"
import { ModelSelector, type ModelSelection } from "@/components/ui/model-selector"
import { durationOptionsFor, supportedAspectRatiosFor, type AspectRatio, type VideoProviderName } from "@/features/videos/schemas"
import { estimateClipCostUsd, klingModel, veoModel } from "@/lib/providers/videos/clip-models"
import { planReel, REEL_LENGTHS, REEL_TRANSITION_LABELS, REEL_TRANSITIONS, type ReelTransition } from "@/features/videos/reel-plan"
import {
  DEFAULT_SEEDANCE_RESOLUTION,
  DRAFT_FINAL_RESOLUTION,
  DRAFT_RESOLUTION,
  estimateSeedanceCostUsd,
  seedanceModel,
  type SeedanceResolution,
} from "@/lib/providers/videos/seedance-models"

type VideoView = {
  id: string
  projectId: string
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  url?: string | null
  progress?: number
  safeErrorCode?: string | null
  draft?: boolean
  model?: string | null
  durationSeconds?: number | null
  createdAt?: string | null
}

type StoryboardSource = { id: string; url: string; position: number }

type ReelView = {
  reelId: string
  count: number
  clips: Array<{ id: string; index: number; status: VideoView["status"]; safeErrorCode?: string | null; url?: string | null; posterUrl?: string | null; model?: string | null; createdAt?: string | null }>
  transition?: string | null
  composition: { id: string; status: string; url: string | null; durationMs: number | null; safeErrorCode: string | null } | null
}

const aspectRatioLabels: Record<AspectRatio, string> = {
  "16:9": "16:9 · Landscape",
  "9:16": "9:16 · Vertical reel",
  "1:1": "1:1 · Square",
  "4:5": "4:5 · Social portrait",
  "4:3": "4:3 · Classic",
  "3:4": "3:4 · Portrait",
}

const MULTI_IMAGE_MESSAGE = "This selection needs the multi-image video provider. Ask a Super Admin to activate FLUX in the video provider settings, or reduce the selection to a single scene."

/** Each scene gets at least this long on screen in a multi-scene take. */
const MIN_SECONDS_PER_SCENE = 2

const TRANSITION_LABELS: Record<string, string> = { CROSSFADE: "Crossfade", DISSOLVE: "Dissolve", FADE_BLACK: "Fade through black", NONE: "Hard cut" }
const TRANSITION_GLYPHS: Record<string, string> = { CROSSFADE: "⤫", DISSOLVE: "∿", FADE_BLACK: "◐", NONE: "|" }

function usd(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`
}

export function VideoGenerator({ projectId, sources, provider, supportedAspectRatios, preferredAspectRatio, defaultPrompt = "" }: { projectId: string; sources: StoryboardSource[]; provider: VideoProviderName; supportedAspectRatios: AspectRatio[]; preferredAspectRatio?: AspectRatio; /** The brief, so the story is not typed twice. */ defaultPrompt?: string }) {
  const [video, setVideo] = useState<VideoView | null>(null)
  const times = useExpectedTimes()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [videoChoice, setVideoChoice] = useState<ModelSelection | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [draft, setDraft] = useState(true)
  const [resolution, setResolution] = useState<SeedanceResolution>(DEFAULT_SEEDANCE_RESOLUTION)
  const [sound, setSound] = useState(true)
  const [transition, setTransition] = useState<ReelTransition>("CROSSFADE")
  const [reel, setReel] = useState<ReelView | null>(null)

  const sceneCount = sources.length
  // The effective provider reflects the user's selected model (falling back to
  // the server-resolved active provider) so capability gating stays accurate.
  const effectiveProvider = (videoChoice?.provider as VideoProviderName | undefined) ?? provider
  const effectiveRatios = videoChoice ? supportedAspectRatiosFor(effectiveProvider) : supportedAspectRatios
  const seedance = effectiveProvider === "seedance" ? seedanceModel(videoChoice?.model) : undefined
  // Veo and Kling: fixed per-second price, 720p/1080p, their own length rules.
  const clip = effectiveProvider === "google" ? veoModel(videoChoice?.model) : effectiveProvider === "kling" ? klingModel(videoChoice?.model) : undefined

  // Server derives the authoritative rows from imageSelections; the client only
  // uses the count to compute the minimum duration. One continuous FLUX render
  // needs at least (count - 1) whole seconds of motion, but never below 5. A
  // Seedance take gives every scene at least two seconds.
  const allowed = durationOptionsFor(effectiveProvider, videoChoice?.model)
  const maxAllowed = allowed[allowed.length - 1]
  const minDuration = seedance
    ? Math.min(maxAllowed, Math.max(allowed[0], sceneCount * MIN_SECONDS_PER_SCENE))
    : clip
      ? allowed[0]
      : Math.max(allowed[0], sceneCount - 1)
  // Beyond one render, offer reel lengths: several clips joined with transitions.
  const durationOptions = useMemo(
    () => [...allowed.filter((seconds) => seconds >= minDuration), ...REEL_LENGTHS.filter((seconds) => seconds > maxAllowed)],
    [allowed, minDuration, maxAllowed],
  )
  // A reel-length default for Seedance, the longest single clip for Veo/Kling (8 s /
  // 10 s), otherwise the shortest valid take. Never a multi-clip reel by default:
  // that multiplies the cost, and is a choice the user makes.
  const singleTakes = durationOptions.filter((seconds) => seconds <= maxAllowed)
  const defaultDuration = seedance
    ? Math.min(maxAllowed, Math.max(minDuration, 15))
    : clip
      ? (singleTakes.includes(10) ? 10 : singleTakes[singleTakes.length - 1] ?? durationOptions[0])
      : minDuration
  const effectiveDuration = duration !== null && durationOptions.includes(duration) ? duration : defaultDuration

  const isReel = effectiveDuration > maxAllowed
  const closesOnFrame = effectiveProvider === "kling" || effectiveProvider === "google" ? Boolean(clip?.lastFrame) : effectiveProvider !== "runway"
  const plan = isReel ? planReel({ targetSeconds: effectiveDuration, durations: allowed, sceneCount, lastFrame: closesOnFrame, transition }) : null
  const draftAvailable = Boolean(seedance?.draft) && !isReel
  const useDraft = draftAvailable && draft
  const effectiveResolution: SeedanceResolution = useDraft
    ? DRAFT_RESOLUTION
    : seedance?.resolutions.includes(resolution)
      ? resolution
      : DEFAULT_SEEDANCE_RESOLUTION
  // Veo renders 1080p only at 8 s; anything else falls back to 720p.
  const clipResolution: "720p" | "1080p" =
    clip && resolution === "1080p" && (effectiveProvider !== "google" || effectiveDuration === 8) ? "1080p" : "720p"
  // A reel costs the sum of its clips.
  const costFor = (seconds: number) =>
    seedance ? estimateSeedanceCostUsd(seedance.id, seconds, effectiveResolution) : clip ? estimateClipCostUsd(clip, seconds, clipResolution) : null
  const estimate = plan
    ? plan.clips.reduce<number | null>((sum, part) => (sum === null ? null : ((costFor(part.seconds) ?? NaN) + sum)), 0)
    : costFor(effectiveDuration)
  const finalEstimate = seedance && useDraft ? estimateSeedanceCostUsd(seedance.id, effectiveDuration, DRAFT_FINAL_RESOLUTION) : null

  // The frames' own shape first (a 9:16 project makes a 9:16 reel), then vertical,
  // since this studio is mostly used for Reels, Shorts and TikTok.
  const defaultAspectRatio = preferredAspectRatio && effectiveRatios.includes(preferredAspectRatio)
    ? preferredAspectRatio
    : effectiveRatios.includes("9:16") ? "9:16" : effectiveRatios[0]
  const runwayBlocked = effectiveProvider === "runway" && sceneCount > 1

  useEffect(() => {
    if (!video || video.status !== "PROCESSING") return
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    async function poll() {
      if (cancelled || document.visibilityState === "hidden") { timeout = setTimeout(poll, 5_000); return }
      const response = await fetch(`/api/videos/${video!.id}/refresh`, { method: "POST" })
      const body = await response.json() as { video?: VideoView; error?: string }
      if (cancelled) return
      if (response.ok && body.video) {
        setVideo(body.video)
        if (body.video.status === "PROCESSING" && attempts < 240) { attempts += 1; timeout = setTimeout(poll, Math.min(15_000, 5_000 + attempts * 500)) }
      } else {
        setError(body.error ?? "Status refresh is temporarily unavailable.")
        timeout = setTimeout(poll, 15_000)
      }
    }
    timeout = setTimeout(poll, 4_000)
    return () => { cancelled = true; if (timeout) clearTimeout(timeout) }
  }, [video?.id, video?.status])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (runwayBlocked) { setError(MULTI_IMAGE_MESSAGE); return }
    setPending(true)
    setError("")
    const form = new FormData(event.currentTarget)
    if (isReel) { await submitReel(form); return }
    // Ownership boundary: the body is strictly project-scoped. The server derives
    // the ordered source images from the project's selections — never trust
    // client-supplied image IDs here.
    const response = await fetch("/api/videos/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        prompt: form.get("prompt"),
        motionStyle: form.get("motionStyle"),
        duration: Number(form.get("duration")),
        aspectRatio: form.get("aspectRatio"),
        ...(videoChoice ? { provider: videoChoice.provider, model: videoChoice.model } : {}),
        ...(seedance ? { draft: useDraft, resolution: effectiveResolution, generateAudio: sound } : {}),
        ...(clip ? { resolution: clipResolution, generateAudio: clip.audioOptional ? sound : true } : {}),
      }),
    })
    const body = await response.json() as { video?: VideoView; error?: string; code?: string }
    setPending(false)
    if (!response.ok || !body.video) {
      if (body.code === "MULTI_IMAGE_REQUIRES_FLUX") { setError(MULTI_IMAGE_MESSAGE); return }
      setError(body.error ?? "Video generation could not start.")
      return
    }
    setVideo(body.video)
  }

  useEffect(() => {
    if (!reel || reel.composition?.status === "COMPLETED" || reel.composition?.status === "FAILED") return
    if (reel.clips.some((part) => part.status === "FAILED")) return
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/videos/reel/${reel.reelId}`).catch(() => null)
      const body = (await response?.json().catch(() => null)) as ReelView | null
      if (response?.ok && body) setReel(body)
    }, 6_000)
    return () => clearTimeout(timer)
  }, [reel])

  async function submitReel(form: FormData) {
    const response = await fetch("/api/videos/reel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        prompt: form.get("prompt"),
        motionStyle: form.get("motionStyle"),
        targetSeconds: effectiveDuration,
        aspectRatio: form.get("aspectRatio"),
        provider: effectiveProvider,
        model: videoChoice?.model,
        transition,
        ...(seedance ? { resolution: effectiveResolution, generateAudio: sound } : {}),
        ...(clip ? { resolution: clipResolution, generateAudio: clip.audioOptional ? sound : true } : {}),
      }),
    })
    const body = (await response.json().catch(() => ({}))) as { reelId?: string; plan?: { clips: unknown[] }; clips?: ReelView["clips"]; error?: string }
    setPending(false)
    if (!response.ok || !body.reelId) { setError(body.error ?? "The reel could not start."); return }
    setReel({ reelId: body.reelId, count: body.plan?.clips.length ?? 0, clips: (body.clips ?? []).map((part, index) => ({ ...part, index })), composition: null })
  }

  async function renderFinal() {
    if (!video) return
    setPending(true)
    setError("")
    const response = await fetch(`/api/videos/${video.id}/finalize`, { method: "POST" })
    const body = await response.json() as { video?: VideoView; error?: string }
    setPending(false)
    if (!response.ok || !body.video) { setError(body.error ?? "The final video could not start."); return }
    setVideo(body.video)
  }

  if (reel) {
    const done = reel.composition?.status === "COMPLETED" && reel.composition.url
    if (done) return <VideoPlayer url={reel.composition!.url!} projectId={projectId} downloadUrl={`/api/compositions/${reel.composition!.id}/download`} />
    const failedClip = reel.clips.find((part) => part.status === "FAILED")
    const finished = reel.clips.filter((part) => part.status === "COMPLETED").length
    return (
      <section className="video-result" aria-live="polite">
        <div>
          <p className="eyebrow">Reel · {reel.count} clips</p>
          <h2>{failedClip || reel.composition?.status === "FAILED" ? "The reel stopped." : reel.composition ? "Joining your clips…" : "Rendering your clips…"}</h2>
          <p>
            {failedClip
              ? "One clip could not be rendered, so the reel was not joined. The finished clips are saved in your video library; adjust the prompt and try again."
              : reel.composition
                ? "Every clip is in. They are being joined with transitions, and the sound is balanced across the whole reel."
                : `${finished} of ${reel.count} clips finished. Clips render at the same time, and the reel is joined as soon as the last one is in.`}
          </p>
        </div>
        {/* The reel as it is being built: each clip on the timeline (its scene while it
            renders, the clip itself once ready), the transitions between them, and the
            join. Everything shown is the real status of each part. */}
        <div className="reel-timeline" aria-label="Reel timeline">
          {reel.clips.map((part, index) => (
            <div key={part.id} className="reel-timeline-item">
              {index > 0 ? (
                <span className="reel-transition" data-active={reel.composition?.status === "RENDERING" || reel.composition?.status === "QUEUED" || undefined} title={TRANSITION_LABELS[reel.transition ?? ""] ?? "Transition"}>
                  {TRANSITION_GLYPHS[reel.transition ?? ""] ?? "⟷"}
                </span>
              ) : null}
              <figure className="reel-clip" data-status={part.status.toLowerCase()}>
                {part.status === "COMPLETED" && part.url ? (
                  <video src={part.url} poster={part.posterUrl ?? undefined} muted loop autoPlay playsInline preload="metadata" />
                ) : part.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={part.posterUrl} alt="" />
                ) : null}
                {part.status !== "COMPLETED" && part.status !== "FAILED" ? <span className="shimmer-accent reel-clip-shimmer" aria-hidden="true" /> : null}
                <figcaption>
                  <span>Clip {part.index + 1}</span>
                  <b>{part.status === "COMPLETED" ? "Ready" : part.status === "FAILED" ? "Failed" : "Rendering"}</b>
                </figcaption>
              </figure>
            </div>
          ))}
        </div>
        <div className="reel-join" data-status={reel.composition?.status?.toLowerCase() ?? (finished === reel.count ? "rendering" : "waiting")}>
          <div className="reel-join-head">
            <span>{reel.composition?.status === "COMPLETED" ? "Joined" : reel.composition?.status === "FAILED" ? "Join failed" : reel.composition || finished === reel.count ? "Joining clips, balancing sound" : `Join starts when all ${reel.count} clips are in`}</span>
            <b>{finished}/{reel.count} clips</b>
          </div>
          <div className="reel-join-bar" aria-hidden="true">
            <span style={{ width: `${reel.composition?.status === "COMPLETED" ? 100 : Math.round((finished / Math.max(1, reel.count)) * 80)}%` }} />
          </div>
        </div>
        {failedClip || reel.composition?.status === "FAILED" ? null : (
          <WhileYouWait
            expectedMs={expectedReelMs(times, reel.clips.find((part) => part.model)?.model ?? videoChoice?.model)}
            startedAt={reel.clips.map((part) => (part.createdAt ? Date.parse(part.createdAt) : NaN)).filter(Number.isFinite).sort()[0]}
            extra={<a href={`/dashboard/projects/${projectId}#captions`}>Write the captions meanwhile.</a>}
          />
        )}
      </section>
    )
  }

  if (video?.status === "COMPLETED" && video.url) {
    if (!video.draft) return <VideoPlayer url={video.url} projectId={projectId} videoId={video.id} />
    const approve = video.model && video.durationSeconds ? estimateSeedanceCostUsd(video.model, video.durationSeconds, DRAFT_FINAL_RESOLUTION) : null
    return (
      <section className="video-result">
        <div>
          <p className="eyebrow">Draft preview · 480p</p>
          <h2>Happy with the motion?</h2>
          <p>This low-cost draft shows the shots, timing and movement. The final keeps exactly this take and renders it in full 1080p.</p>
        </div>
        <video src={video.url} controls playsInline preload="metadata">Your browser does not support video playback.</video>
        <div className="video-result-actions">
          <button type="button" className="primary-button" onClick={renderFinal} disabled={pending}>
            <Wand2 size={17} /> {pending ? "Starting the final render…" : `Render final 1080p · ≈ ${usd(approve)}`}
          </button>
          <button type="button" className="secondary-button" onClick={() => setVideo(null)} disabled={pending}>Adjust and try again</button>
        </div>
        <p className="form-error" aria-live="polite">{error}</p>
      </section>
    )
  }
  const captionsLink = <a href={`/dashboard/projects/${projectId}#captions`}>Write the captions meanwhile.</a>
  if (video) return <><VideoProgress status={video.status} progress={video.progress} />{video.status === "PENDING" || video.status === "PROCESSING" ? <WhileYouWait expectedMs={expectedVideoMs(times, video.model ?? videoChoice?.model)} startedAt={video.createdAt ? Date.parse(video.createdAt) : undefined} extra={captionsLink} /> : null}{video.status === "FAILED" ? <p className="workspace-message">The render stopped safely. Your selected scenes and project are unchanged.</p> : null}{error ? <p className="workspace-message">{error}</p> : null}</>

  return (
    <div className="video-creator">
      <aside className="video-source">
        <p className="eyebrow">{sceneCount > 1 ? `${sceneCount} ordered scenes` : "Selected source frame"}</p>
        <ol className="video-storyboard">
          {sources.map((source, index) => (
            <li key={source.id} className="video-storyboard-scene" data-testid="storyboard-scene">
              <span className="video-scene-number" data-testid="scene-number">{index + 1}</span>
              <img src={source.url} alt={`Scene ${index + 1} source frame`} />
              <span className="video-scene-label">Scene {index + 1}</span>
            </li>
          ))}
        </ol>
        <span className="video-source-note">
          <Film size={15} />{" "}
          {seedance
            ? sceneCount > 1
              ? `Seedance turns these ${sceneCount} scenes into one continuous take, with the real product kept identical in every shot.`
              : "Seedance builds the take around this frame and the real product photos."
            : sceneCount > 1
              ? "FLUX weaves these frames into one continuous multi-scene video."
              : "This exact frame anchors the video."}
        </span>
      </aside>
      <form className="video-form" onSubmit={submit}>
        <ModelSelector endpoint="/api/videos/models" recommended={RECOMMENDED_VIDEO_MODEL} label="Video model" value={videoChoice} onChange={setVideoChoice} disabled={pending} />
        <div>
          <label htmlFor="video-prompt">Video prompt</label>
          <textarea
            id="video-prompt"
            name="prompt"
            minLength={8}
            maxLength={2000}
            required
            defaultValue={defaultPrompt.length >= 8 ? defaultPrompt : undefined}
            placeholder="A creator unboxes the product, holds it up to the camera, turns it to show the details, then uses it with a big smile. Upbeat and authentic; the product stays exactly as shown and the last shot ends on it."
          />
        </div>
        <div className="video-form-grid">
          <label>Motion style<select name="motionStyle" defaultValue="UGC"><option value="UGC">UGC · creator style</option><option value="PRODUCT_360">360° product spin</option><option value="CINEMATIC">Cinematic</option><option value="PRODUCT_COMMERCIAL">Product commercial</option><option value="LUXURY">Luxury</option><option value="DYNAMIC">Dynamic</option><option value="MINIMAL">Minimal</option><option value="CUSTOM">Custom</option></select></label>
          <label>Duration<select name="duration" value={effectiveDuration} onChange={(event) => setDuration(Number(event.target.value))}>{durationOptions.map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
          <label>Aspect ratio<select name="aspectRatio" key={effectiveProvider} defaultValue={defaultAspectRatio}>{effectiveRatios.map((ratio) => <option key={ratio} value={ratio}>{aspectRatioLabels[ratio]}</option>)}</select></label>
          {seedance && !useDraft ? (
            <label>Resolution<select value={effectiveResolution} onChange={(event) => setResolution(event.target.value as SeedanceResolution)}>{seedance.resolutions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          ) : null}
          {clip ? (
            <label>Resolution<select value={clipResolution} onChange={(event) => setResolution(event.target.value as SeedanceResolution)}>{clip.resolutions.map((value) => <option key={value} value={value} disabled={effectiveProvider === "google" && value === "1080p" && effectiveDuration !== 8}>{value}{effectiveProvider === "google" && value === "1080p" ? " (8 s only)" : ""}</option>)}</select></label>
          ) : null}
        </div>
        {plan ? (
          <div className="video-options">
            <p className="video-cost">
              <b>Reel:</b> {plan.clips.length} clips ({plan.clips.map((part) => `${part.seconds}s`).join(" + ")}) joined into ≈ {plan.totalSeconds} s.
              {closesOnFrame && sceneCount > 1 ? " Each clip ends on the frame the next one starts from, so the cuts flow." : ""}
            </p>
            <label>
              Transition
              <select value={transition} onChange={(event) => setTransition(event.target.value as ReelTransition)}>
                {REEL_TRANSITIONS.map((value) => <option key={value} value={value}>{REEL_TRANSITION_LABELS[value]}</option>)}
              </select>
            </label>
          </div>
        ) : isReel ? (
          <p className="workspace-message" role="alert">That length needs more than six clips with this model. Choose a shorter reel or a longer-clip model.</p>
        ) : null}
        {clip ? (
          <div className="video-options">
            {clip.audioOptional ? (
              <label className="video-option">
                <input type="checkbox" checked={sound} onChange={(event) => setSound(event.target.checked)} />
                <span><b>Generate sound</b> Native audio synced to the picture.</span>
              </label>
            ) : (
              <p className="video-cost">Sound is always included with {clip.label}.</p>
            )}
            <p className="video-cost">
              {effectiveProvider === "kling"
                ? "Kling keeps your frames' shape, so a vertical reel needs vertical (9:16) images."
                : clip.referenceImages > 0
                  ? "At 8 seconds Veo also uses the real product photos as references, so the product stays exact."
                  : "Veo renders 16:9 or 9:16."}
              {sceneCount > 1 && clip.lastFrame ? " The first scene opens the clip and the last scene closes it." : ""}
            </p>
            <p className="video-cost" aria-live="polite">Estimated cost <b>{usd(estimate)}</b> · charged only if the clip renders</p>
          </div>
        ) : null}
        {seedance ? (
          <div className="video-options">
            {draftAvailable ? (
              <label className="video-option">
                <input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />
                <span><b>Preview a draft first</b> Cheap 480p take to check the motion; render the 1080p final only if you like it.</span>
              </label>
            ) : null}
            <label className="video-option">
              <input type="checkbox" checked={sound} onChange={(event) => setSound(event.target.checked)} />
              <span><b>Generate sound</b> Voice, ambience and music synced to the picture.</span>
            </label>
            <p className="video-cost" aria-live="polite">
              Estimated cost <b>{usd(estimate)}</b>
              {useDraft ? <> for the draft · final 1080p ≈ <b>{usd(finalEstimate)}</b></> : null}
            </p>
          </div>
        ) : null}
        {runwayBlocked ? <p className="workspace-message" role="alert">{MULTI_IMAGE_MESSAGE}</p> : null}
        <button className="primary-button" disabled={pending || (runwayBlocked && !isReel) || (isReel && !plan)}><Sparkles size={17} />{pending ? "Sending to the motion studio…" : `${isReel ? `Generate ${effectiveDuration} s reel` : useDraft ? "Generate draft preview" : "Generate video"}${estimate !== null && Number.isFinite(estimate) ? ` · ≈ ${usd(estimate)}` : ""}`}</button>
        {!clip && !seedance ? <p className="video-cost">This provider reports its price once the video renders; the exact cost then appears in the project&rsquo;s spend.</p> : null}
        <p className="form-error" aria-live="polite">{error}</p>
      </form>
    </div>
  )
}
