"use client"

import { CaretDown, FrameCorners } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/cn"
import { IMAGE_FORMATS, IMAGE_FORMAT_LABELS, type ImageFormat } from "@/lib/providers/images/formats"

/**
 * Frame shape for a run of concept images, styled to sit beside ModelSelector.
 *
 * A native select on purpose: five options, and on a phone the OS picker is the most
 * usable control there is. The shape matters downstream — image-to-video models keep
 * the first frame's shape, so vertical frames are what make a vertical reel.
 */
export function FormatSelector({
  value,
  onChange,
  disabled,
  className,
}: {
  value: ImageFormat
  onChange: (format: ImageFormat) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <span className="inline-flex items-center gap-1.5 font-mono text-[0.7rem] tracking-[0.12em] text-faint uppercase">
        <FrameCorners size={12} weight="fill" aria-hidden="true" />
        Format
      </span>
      <span className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as ImageFormat)}
          className={cn(
            "min-h-11 w-full appearance-none rounded-full py-2 pr-9 pl-4 text-[0.88rem] font-medium text-fg",
            "bg-white/[0.035] shadow-[inset_0_0_0_1px_var(--line-soft)]",
            "transition-all duration-300 ease-glide hover:bg-white/[0.07] disabled:opacity-55",
          )}
        >
          {IMAGE_FORMATS.map((format) => (
            <option key={format} value={format} className="bg-ink-3">
              {IMAGE_FORMAT_LABELS[format]}
            </option>
          ))}
        </select>
        <CaretDown size={14} weight="light" aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted" />
      </span>
    </label>
  )
}
