"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react"
import { ArrowUp } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/cn"

/**
 * The message box.
 *
 * A textarea rather than an input, because the answers people give here are
 * sentences: "it is a matte black steel bottle, mostly for trail runners". It grows
 * with the content so a long answer is never typed into a one-line slot.
 *
 * Enter sends and Shift+Enter breaks the line, which is what anyone who has used a
 * chat surface expects. The send button stays visible rather than appearing on
 * focus, because a control that materialises is a control people do not find.
 */
export function BriefComposer({
  value,
  onChange,
  onSend,
  placeholder,
  busy,
  disabled,
  autoFocus,
  maxLength = 4_000,
  label,
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  placeholder: string
  /** A turn is in flight. The box stays editable; only sending is blocked. */
  busy?: boolean
  disabled?: boolean
  autoFocus?: boolean
  maxLength?: number
  /** Accessible name. Visible labels are wrong on a chat composer. */
  label: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const sendable = value.trim().length > 0 && !busy && !disabled

  const resize = useCallback(() => {
    const node = ref.current
    if (!node) return
    node.style.height = "auto"
    // Capped so a pasted essay does not push the send button off screen; the
    // textarea scrolls past that point.
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`
  }, [])

  // Layout effect so a prefilled value is already the right height on first paint.
  useLayoutEffect(resize, [resize, value])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // `isComposing` matters for IME input: Enter commits a candidate rather than
    // sending, and ignoring that would submit half-typed Japanese or Chinese.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (sendable) onSend()
  }

  return (
    <div
      className={cn(
        "relative flex items-end gap-2 rounded-card bg-ink-2/80 p-2 pl-4",
        "shadow-[inset_0_0_0_1px_var(--line)]",
        "transition-shadow duration-500 ease-glide",
        "focus-within:shadow-[inset_0_0_0_1px_--alpha(var(--color-accent)/45%)]",
      )}
    >
      <label className="sr-only" htmlFor="brief-composer">
        {label}
      </label>
      <textarea
        ref={ref}
        id="brief-composer"
        rows={1}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(
          "scrollbar-slim min-h-11 flex-1 resize-none bg-transparent py-2.5",
          "text-[0.95rem] leading-relaxed text-fg placeholder:text-faint",
          "focus:outline-none disabled:opacity-55",
        )}
      />
      <button
        type="button"
        onClick={onSend}
        disabled={!sendable}
        aria-label="Send"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          "transition-all duration-500 ease-glide",
          "active:scale-95 disabled:pointer-events-none",
          sendable ? "bg-accent text-ink hover:bg-accent-lift" : "bg-white/8 text-faint",
        )}
      >
        {busy ? (
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
          />
        ) : (
          <ArrowUp size={18} weight="bold" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
