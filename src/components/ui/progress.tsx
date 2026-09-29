import { cn } from "@/lib/cn"

/**
 * Progress bars.
 *
 * Two genuinely different states, kept as separate components so a caller has
 * to be honest about which one it has:
 *
 *   `Progress`      — a real percentage from the provider or the render job.
 *   `ProgressPulse` — work is happening but the duration is unknown.
 *
 * The previous implementation faked the first using a timer, which meant the
 * bar could sit at 80% for minutes. An indeterminate pulse is the truthful
 * treatment when there is no number, and it reads as more responsive than a
 * stalled percentage.
 */

export function Progress({
  value,
  label,
  className,
}: {
  /** 0–100. Clamped, so a provider returning 0–1 or >100 cannot break layout. */
  value: number
  /** Announced to assistive technology. Required — a bare bar says nothing. */
  label: string
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-1.5 overflow-hidden rounded-full bg-white/8", className)}
    >
      <span
        className="block h-full rounded-full bg-accent transition-[width] duration-700 ease-out-expo"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export function ProgressPulse({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      // No aria-valuenow: its absence is what tells assistive tech the progress
      // is indeterminate.
      className={cn("relative h-1.5 overflow-hidden rounded-full bg-white/8", className)}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent"
        style={{ animation: "var(--animate-sheen)" }}
      />
    </div>
  )
}

/**
 * Step tracker for a multi-stage run. Shows where the work actually is rather
 * than a single opaque bar, which is what makes a two-minute render tolerable.
 */
export type StepState = "pending" | "active" | "done" | "failed"

export function StepTrail({
  steps,
  className,
}: {
  steps: readonly { label: string; state: StepState }[]
  className?: string
}) {
  return (
    <ol className={cn("flex flex-col gap-1", className)}>
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={cn(
            "flex items-center gap-3 rounded-field px-3 py-2.5 text-[0.88rem]",
            "transition-colors duration-500",
            step.state === "active" && "bg-accent/6 text-fg",
            step.state === "done" && "text-muted",
            step.state === "pending" && "text-dim",
            step.state === "failed" && "bg-danger/8 text-danger",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[0.62rem] tabular-nums",
              step.state === "done" && "bg-accent/18 text-accent",
              step.state === "active" && "bg-accent text-ink",
              step.state === "pending" && "bg-white/8 text-faint",
              step.state === "failed" && "bg-danger/20 text-danger",
            )}
          >
            {step.state === "done" ? "✓" : step.state === "failed" ? "!" : index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate">{step.label}</span>
          {step.state === "active" ? (
            <span
              aria-hidden="true"
              className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent"
            />
          ) : null}
        </li>
      ))}
    </ol>
  )
}
