"use client"

import Image from "next/image"
import {
  ArrowsOutSimple,
  ArrowsClockwise,
  Check,
  Plus,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/cn"
import { Button } from "@/components/ui/button"
import type { ImageSnapshot } from "@/features/projects/snapshot"

/**
 * One generated concept.
 *
 * The waiting state gets as much attention as the finished one. A generation run
 * is minutes long and this grid is what the user watches, so a pending tile says
 * where it is in the queue, a generating tile carries the accent shimmer that
 * means "the model is working", and a failed tile offers the fix rather than just
 * reporting the problem.
 */
/** Tailwind aspect box per frame shape (see lib/providers/images/formats.ts). */
const FORMAT_ASPECT: Record<string, string> = {
  "9:16": "aspect-[9/16]",
  "4:5": "aspect-[4/5]",
  "1:1": "aspect-square",
  "16:9": "aspect-video",
  "3:2": "aspect-3/2",
}

export function ImageConceptCard({
  image,
  selectedOrder,
  onToggle,
  onPreview,
  onRetry,
  disabled,
  format,
}: {
  image: ImageSnapshot
  /** The project's frame shape, so a 9:16 concept is shown whole rather than cropped to 3:2. */
  format?: string | null
  /** 1-based scene number when selected, null when not. */
  selectedOrder: number | null
  onToggle: () => void
  onPreview: () => void
  onRetry: () => void
  disabled?: boolean
}) {
  const selected = selectedOrder !== null
  const label = String(image.position).padStart(2, "0")
  const recommended = image.evaluation?.recommended ?? false

  return (
    <article
      className={cn(
        "shell group transition-transform duration-500 ease-glide",
        selected && "shadow-[inset_0_0_0_1px_var(--color-accent)]",
      )}
    >
      <div className="core overflow-hidden">
        <div className={`relative w-full overflow-hidden bg-ink-3 ${FORMAT_ASPECT[format ?? "3:2"] ?? "aspect-3/2"}`}>
          {image.url ? (
            <Image
              src={image.url}
              alt={`Generated campaign concept ${label}`}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 33vw"
              className="concept-reveal object-cover transition-transform duration-700 ease-glide group-hover:scale-[1.03]"
            />
          ) : (
            <Placeholder status={image.status} label={label} errorCode={image.safeErrorCode} />
          )}

          {recommended ? (
            <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[0.7rem] font-medium text-ink">
              <Sparkle size={11} weight="fill" aria-hidden="true" />
              AI pick
            </span>
          ) : null}

          {selected ? (
            <span
              className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-full bg-accent font-mono text-[0.78rem] tabular-nums text-ink"
              aria-label={`Selected as scene ${selectedOrder}`}
            >
              {selectedOrder}
            </span>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex min-w-0 flex-col">
            <span className="font-mono text-[0.72rem] tracking-[0.1em] text-faint uppercase">
              Concept {label}
            </span>
            {image.evaluation ? (
              <span className="text-[0.82rem] text-muted">
                <strong className="font-medium text-fg tabular-nums">
                  {Math.round(image.evaluation.score)}
                </strong>
                <span className="text-faint">/100</span>
              </span>
            ) : null}
          </div>

          {image.status === "COMPLETED" ? (
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="ghost" onClick={onPreview} aria-label={`Preview concept ${label}`}>
                <ArrowsOutSimple size={15} weight="light" aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                variant={selected ? "primary" : "secondary"}
                onClick={onToggle}
                disabled={disabled}
                leading={
                  selected ? (
                    <Check size={14} weight="bold" aria-hidden="true" />
                  ) : (
                    <Plus size={14} weight="bold" aria-hidden="true" />
                  )
                }
              >
                {selected ? "In video" : "Add"}
              </Button>
            </div>
          ) : image.status === "FAILED" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRetry}
              disabled={disabled}
              leading={<ArrowsClockwise size={14} weight="bold" aria-hidden="true" />}
            >
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

/** What a failure means, in words a user can act on. */
function failureText(code: string | null | undefined): string {
  switch (code) {
    case "PROVIDER_MODERATED":
      return "Refused by the model's content filter. Retry, or try Nano Banana"
    case "PROVIDER_RATE_LIMIT":
      return "The provider is busy. Retry in a minute"
    case "PROVIDER_UNAVAILABLE":
      return "The provider did not respond. Retry"
    case "PROVIDER_REJECTED":
      return "The provider rejected this request. Try another model"
    default:
      return "Generation stopped. Retry"
  }
}

function Placeholder({ status, label, errorCode }: { status: ImageSnapshot["status"]; label: string; errorCode?: string | null }) {
  const generating = status === "GENERATING"
  const failed = status === "FAILED"

  return (
    <div className="absolute inset-0 grid place-items-center">
      {/* Accent shimmer means the model is working. A neutral one would read as
          "still loading the page", which is a different kind of waiting. */}
      {generating ? <span aria-hidden="true" className="shimmer-accent absolute inset-0" /> : null}

      <div className="relative flex flex-col items-center gap-2 text-center">
        <span
          className={cn(
            "font-mono text-3xl tabular-nums",
            generating ? "text-accent/70" : failed ? "text-danger/60" : "text-dim",
          )}
        >
          {label}
        </span>
        <p
          className={cn(
            "flex max-w-[16rem] items-center gap-1.5 px-4 text-center text-[0.8rem]",
            failed ? "text-danger" : "text-muted",
          )}
        >
          {failed ? (
            <>
              <WarningCircle size={14} weight="light" aria-hidden="true" className="shrink-0" />
              {failureText(errorCode)}
            </>
          ) : generating ? (
            "Painting this scene"
          ) : (
            "Waiting in sequence"
          )}
        </p>
      </div>
    </div>
  )
}
