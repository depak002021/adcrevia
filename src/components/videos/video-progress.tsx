import { Check, Circle, LoaderCircle, TriangleAlert } from "lucide-react"

const steps = [
  { label: "Preparing source image", emoji: "🖼️" },
  { label: "Preparing creative instructions", emoji: "📝" },
  { label: "Creating motion", emoji: "🎬" },
  { label: "Rendering", emoji: "🎞️" },
  { label: "Finalizing", emoji: "✨" },
]

export function VideoProgress({ status, progress: reported }: { status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"; progress?: number | null }) {
  // Most providers report no percentage; null must read as "unknown", not as "%".
  const progress = typeof reported === "number" && Number.isFinite(reported) ? reported : undefined
  const activeIndex = status === "PENDING" ? 1 : status === "PROCESSING" ? 2 : status === "COMPLETED" ? steps.length : 2
  const heading = status === "COMPLETED" ? "Motion complete 🎉" : status === "FAILED" ? "Generation paused" : "Creating motion 🎬"
  return (
    <section className="video-progress" aria-live="polite">
      <div className="video-progress-heading">
        <div><p className="eyebrow">Generation status</p><h2>{heading}</h2></div>
        {progress !== undefined ? <span>{progress}%</span> : <span className="indeterminate-label">In progress…</span>}
      </div>
      {progress !== undefined ? (
        <div className="provider-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
      ) : status === "PROCESSING" ? (
        <div className="indeterminate-progress" aria-hidden><span /></div>
      ) : null}
      <ol>
        {steps.map((step, index) => {
          const complete = status === "COMPLETED" || index < activeIndex
          const active = status !== "COMPLETED" && index === activeIndex
          const failed = status === "FAILED" && active
          return (
            <li key={step.label} data-active={active || undefined} data-complete={complete || undefined}>
              {failed ? <TriangleAlert /> : complete ? <Check /> : active ? <LoaderCircle className="spin" /> : <Circle />}
              <span><span className="step-emoji" aria-hidden>{step.emoji}</span> {step.label}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
