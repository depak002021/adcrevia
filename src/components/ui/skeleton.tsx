import { cn } from "@/lib/cn"

/**
 * Loading placeholders.
 *
 * One implementation for every waiting state, replacing three separate
 * inline-styled shimmer hacks and the nine server-rendered pages that had no
 * loading treatment at all.
 *
 * The distinction that matters: `tone="neutral"` means "waiting on the
 * network", `tone="accent"` means "the model is working". Using the accent
 * shimmer only for generation makes the studio legible at a glance — a grid of
 * accent-tinted tiles reads as active production, neutral tiles read as a page
 * that has not finished loading.
 */

type Tone = "neutral" | "accent"

const toneClass: Record<Tone, string> = {
  neutral: "shimmer",
  accent: "shimmer-accent",
}

export function Skeleton({
  className,
  tone = "neutral",
  /** Staggers the sweep so a grid does not pulse in unison. */
  index = 0,
}: {
  className?: string
  tone?: Tone
  index?: number
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("block rounded-chip", toneClass[tone], className)}
      style={index ? { animationDelay: `${(index % 6) * 0.11}s` } : undefined}
    />
  )
}

/** Text line group with a natural ragged edge on the last line. */
export function SkeletonText({
  lines = 3,
  className,
  tone = "neutral",
}: {
  lines?: number
  className?: string
  tone?: Tone
}) {
  return (
    <span aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          tone={tone}
          index={index}
          className={cn("h-3", index === lines - 1 ? "w-[62%]" : "w-full")}
        />
      ))}
    </span>
  )
}

/**
 * Placeholder matching the creative direction card's real geometry, so the
 * streamed cards do not shift layout as they arrive.
 */
export function SkeletonDirectionCard({ index = 0 }: { index?: number }) {
  return (
    <div
      aria-hidden="true"
      className="shell pointer-events-none"
      style={{ animation: "var(--animate-breathe)", animationDelay: `${(index % 4) * 0.14}s` }}
    >
      <div className="core flex min-h-[22rem] flex-col gap-4 p-6">
        <Skeleton index={index} className="h-6 w-10 rounded-full" />
        <Skeleton index={index} className="h-6 w-[62%]" />
        <SkeletonText lines={3} />
        <div className="mt-auto flex gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} index={index + i} className="h-10 flex-1 rounded-field" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Placeholder for an image tile in the concept grid, at the real 3:2 ratio. */
export function SkeletonImageTile({ index = 0 }: { index?: number }) {
  return (
    <div aria-hidden="true" className="shell pointer-events-none">
      <div className="core overflow-hidden">
        <Skeleton tone="accent" index={index} className="aspect-3/2 w-full rounded-none" />
        <div className="flex items-center justify-between gap-3 p-4">
          <Skeleton index={index} className="h-3 w-20" />
          <Skeleton index={index + 1} className="h-3 w-10" />
        </div>
      </div>
    </div>
  )
}
