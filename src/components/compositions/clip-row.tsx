"use client"

import { ArrowDown, ArrowUp, Scissors, Trash } from "@phosphor-icons/react/dist/ssr"

import { formatDuration, timelineClipDurationMs, type TimelineClip } from "@/features/compositions/timeline"
import { clipTransitions } from "@/features/compositions/schemas"
import { cn } from "@/lib/cn"

/**
 * One clip on the timeline.
 *
 * Reordering is arrow buttons, not only drag-and-drop. A pointer-only timeline is
 * unusable with a keyboard or a screen reader, and precise dragging is exactly what
 * somebody with a motor impairment cannot do — so the accessible path is the primary
 * one here rather than an afterthought.
 *
 * Trim is two range sliders over the source's real length. A numeric field would be
 * more precise and far worse: nobody knows where 2,340 milliseconds is in a clip they
 * have watched once.
 */

const TRANSITION_LABELS: Record<(typeof clipTransitions)[number], string> = {
  NONE: "Cut",
  CROSSFADE: "Cross-fade",
  DISSOLVE: "Dissolve",
  FADE_BLACK: "Through black",
  WIPE_LEFT: "Wipe left",
  WIPE_RIGHT: "Wipe right",
}

const SPEEDS = [0.5, 0.75, 1, 1.5, 2] as const

export function ClipRow({
  clip,
  index,
  total,
  posterUrl,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  clip: TimelineClip
  index: number
  total: number
  posterUrl: string | null
  disabled?: boolean
  onChange: (next: TimelineClip) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const duration = timelineClipDurationMs(clip)
  const outMs = clip.trimOutMs ?? clip.sourceDurationMs
  const isLast = index === total - 1

  return (
    <li className="shell">
      <div className="core flex flex-col gap-4 p-4">
        <div className="flex items-start gap-3">
          <div className="relative size-16 shrink-0 overflow-hidden rounded-inner bg-ink-3">
            {posterUrl ? (
              // A still, not a <video>: ten autoplaying previews on a phone is a
              // decoding cost nobody asked for.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={posterUrl}
                alt=""
                className="size-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : null}
            <span className="absolute bottom-0 left-0 bg-ink/80 px-1.5 py-0.5 font-mono text-[0.62rem] tabular-nums text-fg">
              {String(index + 1).padStart(2, "0")}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-mono text-[0.72rem] tabular-nums text-muted">
              {formatDuration(duration)}
              {clip.speed !== 1 ? <span className="text-accent"> · {clip.speed}×</span> : null}
            </p>
            <p className="mt-1 text-[0.8rem] text-faint">
              {formatDuration(clip.trimInMs)} → {formatDuration(outMs)} of{" "}
              {formatDuration(clip.sourceDurationMs)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label={`Move clip ${index + 1} earlier`}
              disabled={disabled || index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp size={15} weight="bold" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`Move clip ${index + 1} later`}
              disabled={disabled || isLast}
              onClick={() => onMove(1)}
            >
              <ArrowDown size={15} weight="bold" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`Remove clip ${index + 1}`}
              disabled={disabled || total <= 1}
              onClick={onRemove}
              tone="danger"
            >
              <Trash size={15} weight="bold" aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Range
            label="Start"
            value={clip.trimInMs}
            max={Math.max(200, clip.sourceDurationMs - 200)}
            disabled={disabled}
            onChange={(trimInMs) =>
              onChange({
                ...clip,
                trimInMs,
                // Keeping the out point behind the in point would produce a
                // zero-length clip, which freezes a frame rather than failing.
                trimOutMs: clip.trimOutMs !== null && clip.trimOutMs <= trimInMs + 200 ? null : clip.trimOutMs,
              })
            }
          />
          <Range
            label="End"
            value={outMs}
            min={clip.trimInMs + 200}
            max={clip.sourceDurationMs}
            disabled={disabled}
            onChange={(trimOutMs) =>
              onChange({ ...clip, trimOutMs: trimOutMs >= clip.sourceDurationMs ? null : trimOutMs })
            }
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="font-mono text-[0.66rem] tracking-[0.12em] text-faint uppercase">Speed</span>
            <select
              value={String(clip.speed)}
              disabled={disabled}
              onChange={(event) => onChange({ ...clip, speed: Number(event.target.value) })}
              className="min-h-11 rounded-inner bg-ink-3 px-3 text-[0.85rem] text-fg shadow-[inset_0_0_0_1px_var(--line)] focus:outline-2 focus:outline-offset-2 focus:outline-accent disabled:opacity-55"
            >
              {SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </label>

          {/* The join belongs to the clip before it, so the last clip has none. */}
          {!isLast ? (
            <>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="flex items-center gap-1.5 font-mono text-[0.66rem] tracking-[0.12em] text-faint uppercase">
                  <Scissors size={11} weight="light" aria-hidden="true" />
                  Into the next
                </span>
                <select
                  value={clip.transition}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({ ...clip, transition: event.target.value as TimelineClip["transition"] })
                  }
                  className="min-h-11 rounded-inner bg-ink-3 px-3 text-[0.85rem] text-fg shadow-[inset_0_0_0_1px_var(--line)] focus:outline-2 focus:outline-offset-2 focus:outline-accent disabled:opacity-55"
                >
                  {clipTransitions.map((transition) => (
                    <option key={transition} value={transition}>
                      {TRANSITION_LABELS[transition]}
                    </option>
                  ))}
                </select>
              </label>

              {clip.transition !== "NONE" ? (
                // A minimum width so that on a phone the slider wraps onto its own line
                // instead of squeezing beside the selects and pushing past the screen edge.
                <label className="flex min-w-[11rem] flex-1 flex-col gap-1.5">
                  <span className="flex items-baseline justify-between gap-2 font-mono text-[0.66rem] tracking-[0.12em] text-faint uppercase">
                    Overlap
                    <span className="tabular-nums normal-case">{(clip.transitionMs / 1000).toFixed(1)}s</span>
                  </span>
                  <input
                    type="range"
                    min={100}
                    max={2000}
                    step={50}
                    value={clip.transitionMs}
                    disabled={disabled}
                    onChange={(event) => onChange({ ...clip, transitionMs: Number(event.target.value) })}
                    className="slider-accent h-11 w-full"
                    aria-label="Transition length"
                  />
                </label>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function Range({
  label,
  value,
  min = 0,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 font-mono text-[0.66rem] tracking-[0.12em] text-faint uppercase">
        {label}
        <span className="tabular-nums normal-case">{formatDuration(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={Math.max(min, max)}
        // 100ms steps: finer than that is below what anyone can judge by dragging, and
        // it makes the handle feel noisy.
        step={100}
        value={Math.min(Math.max(value, min), Math.max(min, max))}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="slider-accent h-11 w-full"
      />
    </label>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  tone,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  tone?: "danger"
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        // 44px, because these are the controls people miss on a phone.
        "flex size-11 items-center justify-center rounded-full transition-colors duration-300 ease-glide",
        "disabled:pointer-events-none disabled:opacity-30",
        tone === "danger"
          ? "text-muted hover:bg-red-500/12 hover:text-red-300"
          : "text-muted hover:bg-white/[0.07] hover:text-fg",
      )}
    >
      {children}
    </button>
  )
}
