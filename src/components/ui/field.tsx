"use client"

import {
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react"
import { CaretDown } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/cn"

/**
 * Form controls for the whole product.
 *
 * Ported from the marketing site's field module, which already had the
 * accessibility details right, and extended for the studio: leading/trailing
 * slots, a character counter, and an autosizing textarea. Every control here
 * replaces a raw `<input>` — there were 15 files using bare elements, several
 * with no label association at all.
 *
 * Contract shared by every control:
 *   - the label is always associated via `htmlFor`
 *   - `aria-invalid` is set when there is an error
 *   - `aria-describedby` points at the error when present, otherwise the hint,
 *     never both, so screen readers do not read stale help text over a failure
 */

const control = [
  "w-full rounded-field bg-white/[0.035] text-fg",
  "shadow-[inset_0_0_0_1px_var(--line-soft)]",
  "transition-shadow duration-300 outline-none",
  "placeholder:text-dim",
  "focus:shadow-[inset_0_0_0_1px_var(--color-accent)]",
  "disabled:cursor-not-allowed disabled:opacity-55",
].join(" ")

const controlPadding = "px-4 py-3 text-[0.95rem]"
const errorRing = "shadow-[inset_0_0_0_1px_var(--color-danger)]"

type FrameProps = {
  id: string
  label: string
  hint?: string
  error?: string
  optional?: boolean
  /** Rendered on the label row, right-aligned. Used for character counters. */
  meta?: ReactNode
  className?: string
  children: ReactNode
}

function Frame({ id, label, hint, error, optional, meta, className, children }: FrameProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[0.85rem] text-fg">
          {label}
        </label>
        {meta ??
          (optional ? <span className="text-[0.74rem] text-muted">Optional</span> : null)}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[0.78rem] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[0.78rem] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function describedBy(id: string, hint?: string, error?: string) {
  if (error) return `${id}-error`
  if (hint) return `${id}-hint`
  return undefined
}

type SharedField = {
  label: string
  hint?: string
  error?: string
  optional?: boolean
  className?: string
}

/* ---------------------------------------------------------------- TextField */

export type TextFieldProps = SharedField & {
  /** Icon or badge inset on the leading edge. */
  leading?: ReactNode
  /** Inline action on the trailing edge, e.g. an "Analyze" button. */
  trailing?: ReactNode
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, optional, className, leading, trailing, id, ...rest },
  ref,
) {
  const generated = useId()
  const fieldId = id ?? generated

  return (
    <Frame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={className}
    >
      <div className="relative flex items-center">
        {leading ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-4 flex text-muted"
          >
            {leading}
          </span>
        ) : null}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, hint, error)}
          className={cn(
            control,
            controlPadding,
            leading && "pl-11",
            trailing && "pr-28",
            error && errorRing,
          )}
          {...rest}
        />
        {trailing ? <span className="absolute right-1.5 flex">{trailing}</span> : null}
      </div>
    </Frame>
  )
})

/* ----------------------------------------------------------------- TextArea */

export type TextAreaProps = SharedField & {
  /** Grows with content instead of showing an inner scrollbar. */
  autosize?: boolean
  /** Shows `used/maxLength` on the label row. Requires `maxLength`. */
  showCount?: boolean
  value?: string
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "value">

export function TextArea({
  label,
  hint,
  error,
  optional,
  className,
  autosize = true,
  showCount,
  id,
  value,
  maxLength,
  rows = 6,
  onChange,
  ...rest
}: TextAreaProps) {
  const generated = useId()
  const fieldId = id ?? generated
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const node = ref.current
    if (!node || !autosize) return
    node.style.height = "auto"
    node.style.height = `${node.scrollHeight}px`
  }, [autosize])

  // Layout effect so the first paint is already at the right height for a
  // prefilled value, avoiding a visible jump on mount.
  useLayoutEffect(resize, [resize, value])

  return (
    <Frame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={className}
      meta={
        showCount && maxLength ? (
          <span className="font-mono text-[0.72rem] tabular-nums text-muted">
            {(value ?? "").length}/{maxLength}
          </span>
        ) : optional ? (
          <span className="text-[0.74rem] text-muted">Optional</span>
        ) : null
      }
    >
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(event) => {
          onChange?.(event)
          resize()
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(
          control,
          controlPadding,
          "scrollbar-slim resize-none leading-relaxed",
          error && errorRing,
        )}
        {...rest}
      />
    </Frame>
  )
}

/* -------------------------------------------------------------- SelectField */

export type SelectOption = { value: string; label: string; disabled?: boolean }

export type SelectFieldProps = SharedField & {
  options: readonly SelectOption[]
  /** Renders a disabled first option. Omit for a select that always has a value. */
  placeholder?: string
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "children">

export function SelectField({
  label,
  hint,
  error,
  optional,
  className,
  options,
  placeholder,
  id,
  ...rest
}: SelectFieldProps) {
  const generated = useId()
  const fieldId = id ?? generated

  return (
    <Frame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={className}
    >
      <div className="relative">
        <select
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, hint, error)}
          className={cn(
            control,
            controlPadding,
            // The native arrow is replaced so the control matches the rest of
            // the system on every platform.
            "appearance-none pr-11",
            error && errorRing,
          )}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <CaretDown
          size={15}
          weight="light"
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-muted"
        />
      </div>
    </Frame>
  )
}

/* --------------------------------------------------------------- ColorField */

/**
 * A single brand colour. The native picker is kept — it is the only way to get
 * the OS colour tools — but it is driven by a large, clearly-hittable swatch
 * rather than the browser's default control, and the hex value is editable as
 * text so a brand code can be pasted straight in.
 */
export function ColorSwatch({
  value,
  onChange,
  onRemove,
  label,
}: {
  value: string
  onChange: (next: string) => void
  onRemove?: () => void
  label: string
}) {
  const id = useId()

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <label
          htmlFor={id}
          className={cn(
            "block size-11 cursor-pointer rounded-field",
            "shadow-[inset_0_0_0_1px_var(--line-strong)]",
            "transition-transform duration-300 ease-glide hover:scale-105",
          )}
          style={{ backgroundColor: value }}
        >
          <span className="sr-only">{label}</span>
        </label>
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          // Visually hidden rather than display:none so the swatch label can
          // still open the OS picker and the control stays keyboard reachable.
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </div>
      <input
        aria-label={`${label} hex value`}
        value={value.toUpperCase()}
        onChange={(event) => {
          const next = event.target.value.trim()
          if (/^#[0-9a-fA-F]{0,6}$/.test(next)) onChange(next)
        }}
        spellCheck={false}
        className={cn(
          control,
          "w-24 px-3 py-2 font-mono text-[0.8rem] uppercase tabular-nums",
        )}
      />
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          // 44px minimum target. The previous implementation used a ~20px
          // control offset outside the swatch, which was unusable on touch.
          className="flex size-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/[0.06] hover:text-fg"
        >
          <span className="sr-only">Remove {label}</span>
          <span aria-hidden="true" className="text-lg leading-none">
            &times;
          </span>
        </button>
      ) : null}
    </div>
  )
}
