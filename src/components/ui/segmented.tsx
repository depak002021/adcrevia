"use client"

import { useId, useRef, type ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * Segmented control.
 *
 * Replaces the native `<select>` elements in the video form. Those rendered as
 * OS-native wheels on iOS and Android — a jarring break in an otherwise
 * bespoke surface, and a poor fit for choices the user wants to compare side by
 * side (motion style, aspect ratio, duration).
 *
 * Implemented as a real radiogroup with roving tabindex, so arrow keys move
 * between options and only the selected option is in the tab order. That is the
 * behaviour assistive technology expects from a group of mutually exclusive
 * choices, and it is what the native select gave us for free.
 */

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  /** Secondary line, e.g. "Vertical" under "9:16". */
  hint?: string
  disabled?: boolean
  /** Explains why the option cannot be chosen. Announced, not just hovered. */
  disabledReason?: string
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  columns,
  className,
  hint,
}: {
  label: string
  options: readonly SegmentedOption<T>[]
  value: T | null
  onChange: (next: T) => void
  /** Fixed column count. Defaults to a responsive auto-fit grid. */
  columns?: number
  className?: string
  hint?: ReactNode
}) {
  const groupId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const selectable = options.filter((option) => !option.disabled)

  function move(direction: 1 | -1) {
    if (selectable.length === 0) return
    const currentIndex = selectable.findIndex((option) => option.value === value)
    // Wraps, matching native radiogroup behaviour.
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + direction + selectable.length) % selectable.length
    const next = selectable[nextIndex]
    onChange(next.value)
    const node = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-value="${CSS.escape(next.value)}"]`,
    )
    node?.focus()
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span id={`${groupId}-label`} className="text-[0.85rem] text-fg">
          {label}
        </span>
        {hint ? <span className="text-[0.74rem] text-muted">{hint}</span> : null}
      </div>

      <div
        ref={listRef}
        role="radiogroup"
        aria-labelledby={`${groupId}-label`}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault()
            move(1)
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault()
            move(-1)
          }
        }}
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: columns
            ? `repeat(${columns}, minmax(0, 1fr))`
            : "repeat(auto-fit, minmax(7.5rem, 1fr))",
        }}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              data-value={option.value}
              aria-checked={selected}
              // Roving tabindex: only the selected option is tabbable, so the
              // group is a single tab stop.
              tabIndex={selected || (!value && !option.disabled) ? 0 : -1}
              disabled={option.disabled}
              title={option.disabled ? option.disabledReason : undefined}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex min-h-11 flex-col items-start justify-center gap-0.5 rounded-field px-3.5 py-2.5 text-left",
                "transition-all duration-300 ease-glide",
                "disabled:cursor-not-allowed disabled:opacity-40",
                selected
                  ? "bg-accent text-ink shadow-[0_14px_40px_-22px_rgb(216_246_81/0.55)]"
                  : "bg-white/[0.035] text-fg shadow-[inset_0_0_0_1px_var(--line-soft)] enabled:hover:bg-white/[0.07]",
              )}
            >
              <span className="text-[0.88rem] font-medium">{option.label}</span>
              {option.hint ? (
                <span
                  className={cn(
                    "text-[0.72rem]",
                    selected ? "text-ink/65" : "text-muted",
                  )}
                >
                  {option.hint}
                </span>
              ) : null}
              {option.disabled && option.disabledReason ? (
                <span className="sr-only">{option.disabledReason}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
