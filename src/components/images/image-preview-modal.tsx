"use client"

import Image from "next/image"

import { Dialog } from "@/components/ui/dialog"
import type { ImageSnapshot } from "@/features/projects/snapshot"

/**
 * Full-size view of one concept.
 *
 * Replaces a hand-built backdrop that closed on `onMouseDown` and had no Escape
 * key, no focus trap, no focus restoration and no scroll lock. All of that now
 * comes from the Dialog primitive.
 *
 * `hideTitle` keeps the heading announced but off screen: the image is the
 * content, and a header above it would push it out of the viewport on a phone.
 */
export function ImagePreviewModal({
  image,
  onClose,
}: {
  image: ImageSnapshot | null
  onClose: () => void
}) {
  const label = image ? String(image.position).padStart(2, "0") : ""

  return (
    <Dialog
      open={Boolean(image?.url)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="media"
      hideTitle
      title={`Concept ${label}`}
      description={image?.evaluation?.reasoning}
    >
      {image?.url ? (
        <div className="flex flex-col gap-4">
          <div className="relative w-full overflow-hidden rounded-inner bg-ink-3">
            {/*
              Intrinsic sizing rather than `fill`: the dialog is sized to the
              content, so a fixed-height container would letterbox images whose
              ratio differs from the 3:2 the providers usually return.
            */}
            <Image
              src={image.url}
              alt={`Full preview of concept ${label}`}
              width={1536}
              height={1024}
              sizes="(max-width: 768px) 94vw, 68rem"
              className="h-auto w-full object-contain"
              priority
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-[0.72rem] tracking-[0.12em] text-faint uppercase">
                Concept {label}
              </span>
              {image.evaluation ? (
                <span className="text-[0.85rem] text-muted">
                  <strong className="font-medium text-fg tabular-nums">
                    {Math.round(image.evaluation.score)}
                  </strong>
                  <span className="text-faint">/100</span>
                </span>
              ) : null}
            </div>

            {image.evaluation ? (
              <p className="text-[0.88rem] leading-relaxed text-muted">
                {image.evaluation.reasoning}
              </p>
            ) : null}

            {image.evaluation ? <ScoreBreakdown axes={image.evaluation.axes} /> : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}

const AXIS_LABELS: Array<{ key: keyof ImageSnapshotAxes; label: string }> = [
  { key: "productConsistency", label: "Product consistency" },
  { key: "promptAlignment", label: "Brief alignment" },
  { key: "brandAlignment", label: "On brand" },
  { key: "composition", label: "Composition" },
  { key: "visualQuality", label: "Visual quality" },
  { key: "commercialSuitability", label: "Ready to run" },
]

type ImageSnapshotAxes = NonNullable<ImageSnapshot["evaluation"]>["axes"]

/**
 * Why the overall score is what it is.
 *
 * These six numbers were written to the database and never shown, which is the same
 * problem as not having them: a single "84" tells somebody choosing between four
 * images nothing about which one is safe to run. Axes the provider did not score are
 * omitted rather than drawn at zero.
 */
function ScoreBreakdown({ axes }: { axes: ImageSnapshotAxes }) {
  const scored = AXIS_LABELS.filter(({ key }) => typeof axes[key] === "number")
  if (scored.length === 0) return null

  return (
    <dl className="mt-2 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {scored.map(({ key, label }) => {
        const value = Math.round(axes[key] as number)
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[0.8rem] text-muted">{label}</dt>
              <dd className="font-mono text-[0.74rem] tabular-nums text-fg">{value}</dd>
            </div>
            <div
              aria-hidden="true"
              className="h-1 overflow-hidden rounded-full bg-white/8"
            >
              <span
                className="block h-full rounded-full bg-accent/70 transition-[width] duration-700 ease-out-expo"
                style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
              />
            </div>
          </div>
        )
      })}
    </dl>
  )
}
