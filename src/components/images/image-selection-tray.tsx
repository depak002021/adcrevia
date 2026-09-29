"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import {
  ArrowUp,
  ArrowDown,
  FilmStrip,
  X,
} from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/cn"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { Flip, gsap, prefersReducedMotion } from "@/lib/gsap"

export type SelectionItem = { id: string; position: number; url: string | null }

/**
 * The video running order.
 *
 * Previously an in-flow panel below the grid that silently vanished when empty,
 * with three ~34px controls per row. On a phone it was both easy to miss and hard
 * to hit.
 *
 * Now it is a persistent summary bar that opens a bottom sheet. The bar keeps the
 * running order visible while the user is still choosing frames, and the sheet
 * gives the reordering task the whole lower half of the screen with 44px targets.
 *
 * Reordering stays button-driven rather than drag-only. Buttons work with a
 * keyboard and a screen reader; the FLIP animation supplies the physicality that
 * dragging would have, measured from the real before and after layout rather than
 * from guessed offsets.
 */
export function ImageSelectionTray({
  items,
  imageIds,
  onChange,
  onSave,
  saving = false,
  maxSelection,
}: {
  items: SelectionItem[]
  imageIds: string[]
  onChange: (imageIds: string[]) => void
  onSave: (imageIds: string[]) => void
  saving?: boolean
  maxSelection: number
}) {
  const [open, setOpen] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)

  const ordered = imageIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is SelectionItem => Boolean(item))

  if (ordered.length === 0) return null

  /**
   * Animate a reorder from the real layout.
   *
   * Flip records positions before the state change and tweens from them after
   * React has painted, so the motion matches wherever the rows actually landed.
   *
   * The reorder itself is never contingent on the animation. `onChange` runs
   * first and the tweening is wrapped, because an environment without real
   * layout — a test renderer, or a browser that fails to measure — must still
   * reorder the scenes. Decoration cannot be allowed to break the data.
   */
  function reorder(next: string[]) {
    const list = listRef.current

    /**
     * Skip the animation when there is nothing laid out to animate.
     *
     * `offsetHeight === 0` covers a collapsed or detached sheet and any renderer
     * without layout. Flip would otherwise measure a set of zero-size rects and
     * tween between identical positions — pure cost for no visible result.
     */
    const hasLayout = Boolean(list && list.offsetHeight > 0)
    const wantsMotion = hasLayout && !prefersReducedMotion()

    let state: ReturnType<typeof Flip.getState> | null = null
    if (wantsMotion && list) {
      try {
        state = Flip.getState(list.querySelectorAll("[data-scene]"))
      } catch {
        state = null
      }
    }

    onChange(next)

    if (!state || !list) return

    // Deferred a frame so React has committed the new order before Flip measures
    // the destination.
    requestAnimationFrame(() => {
      try {
        Flip.from(state, {
          duration: 0.45,
          ease: "power3.inOut",
          absolute: true,
          onComplete: () => gsap.set(list.querySelectorAll("[data-scene]"), { clearProps: "all" }),
        })
      } catch {
        // The rows are already in the right order; only the transition is lost.
      }
    })
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= imageIds.length) return
    const next = [...imageIds]
    ;[next[index], next[target]] = [next[target], next[index]]
    reorder(next)
  }

  function remove(id: string) {
    reorder(imageIds.filter((imageId) => imageId !== id))
  }

  return (
    <>
      {/* Summary bar. Fixed so the running order stays visible while scrolling
          the grid, and padded for the home indicator. */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 px-4 pt-3"
        style={{ paddingBottom: "calc(0.75rem + var(--safe-bottom))" }}
      >
        <div className="mx-auto flex w-full max-w-[42rem] items-center gap-3 rounded-full bg-ink-3/92 py-2 pr-2 pl-4 backdrop-blur-xl shadow-[0_18px_50px_-24px_rgb(0_0_0/0.9),inset_0_0_0_1px_var(--line-strong)]">
          <span className="flex -space-x-2" aria-hidden="true">
            {ordered.slice(0, 4).map((item) => (
              <span
                key={item.id}
                className="relative size-7 overflow-hidden rounded-full ring-2 ring-ink-3"
              >
                {item.url ? (
                  <Image src={item.url} alt="" fill sizes="28px" className="object-cover" />
                ) : null}
              </span>
            ))}
          </span>

          <span className="min-w-0 flex-1 truncate text-[0.85rem] text-muted">
            <strong className="font-medium text-fg tabular-nums">{ordered.length}</strong>
            <span className="text-faint"> / {maxSelection} scenes</span>
          </span>

          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Arrange
          </Button>
        </div>
      </div>

      {/* Reserves the space the fixed bar occupies, so the last grid row is not
          hidden behind it. */}
      <div aria-hidden="true" className="h-24" />

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Your video sequence"
        description={`${ordered.length} of ${maxSelection} scenes. This is the order they will play in.`}
        snapPoints={[0.6, 0.92]}
        footer={
          <Button
            block
            variant="primary"
            well
            glyph="right"
            busy={saving}
            onClick={() => {
              onSave(imageIds)
              setOpen(false)
            }}
          >
            {saving ? "Saving order" : "Save order"}
          </Button>
        }
      >
        <ol ref={listRef} className="flex flex-col gap-2 pb-2">
          {ordered.map((item, index) => (
            <li
              key={item.id}
              data-scene={item.id}
              className="flex items-center gap-3 rounded-inner bg-white/[0.035] p-2.5 shadow-[inset_0_0_0_1px_var(--line-soft)]"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-[0.75rem] tabular-nums text-ink">
                {index + 1}
              </span>

              <span className="relative size-14 shrink-0 overflow-hidden rounded-chip bg-ink-3">
                {item.url ? (
                  <Image
                    src={item.url}
                    alt={`Scene ${index + 1}`}
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                ) : null}
              </span>

              <span className="min-w-0 flex-1 text-[0.85rem] text-muted">
                Concept {String(item.position).padStart(2, "0")}
              </span>

              <div className="flex shrink-0 items-center gap-0.5">
                <IconButton
                  label={`Move scene ${index + 1} earlier`}
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp size={15} weight="bold" aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Move scene ${index + 1} later`}
                  onClick={() => move(index, 1)}
                  disabled={index === ordered.length - 1}
                >
                  <ArrowDown size={15} weight="bold" aria-hidden="true" />
                </IconButton>
                <IconButton label={`Remove scene ${index + 1}`} onClick={() => remove(item.id)} danger>
                  <X size={15} weight="bold" aria-hidden="true" />
                </IconButton>
              </div>
            </li>
          ))}
        </ol>

        <p className="flex items-center gap-2 pb-4 text-[0.78rem] text-faint">
          <FilmStrip size={14} weight="light" aria-hidden="true" />
          Scenes are woven into one continuous video in this order.
        </p>
      </Sheet>
    </>
  )
}

/** 44px touch target regardless of the 15px glyph inside it. */
function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-11 items-center justify-center rounded-full transition-colors duration-300",
        "disabled:pointer-events-none disabled:opacity-30",
        danger ? "text-muted hover:bg-danger/12 hover:text-danger" : "text-muted hover:bg-white/[0.07] hover:text-fg",
      )}
    >
      <span className="sr-only">{label}</span>
      {children}
    </button>
  )
}
