"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import * as Dialog from "@radix-ui/react-dialog"

import { cn } from "@/lib/cn"
import { prefersReducedMotion } from "@/lib/gsap"

/**
 * Bottom sheet.
 *
 * Built on Radix Dialog, so focus trapping, Escape, scroll locking, aria wiring
 * and focus restoration are all correct without hand-rolling them — the previous
 * hand-built modal in this codebase had none of those.
 *
 * What is added on top:
 *   - snap points, so a sheet can open part-height and be dragged taller
 *   - drag to dismiss, with velocity so a fast flick closes even from high up
 *   - `env(safe-area-inset-bottom)` padding, so actions clear the home bar
 *   - a real grabber, sized as a 44px touch target rather than a 4px bar
 *
 * The drag writes `transform` directly to the node rather than going through
 * React state. A pointermove handler that re-renders cannot hold 60fps on a
 * mid-range phone, and the sheet is the most-touched surface in the studio.
 */

/** Fractions of viewport height the sheet can rest at, smallest first. */
type SnapPoints = readonly number[]

const DISMISS_DISTANCE_RATIO = 0.35
const DISMISS_VELOCITY = 0.55 // px per ms

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  snapPoints = [0.9],
  children,
  footer,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Visually hidden when omitted, but always announced. */
  description?: string
  snapPoints?: SnapPoints
  children: ReactNode
  /** Pinned below the scroll area, inside the safe-area padding. */
  footer?: ReactNode
  className?: string
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [snapIndex, setSnapIndex] = useState(0)

  const drag = useRef<{
    active: boolean
    startY: number
    startTime: number
    lastY: number
    lastTime: number
    offset: number
  } | null>(null)

  // Reset to the smallest snap point each time the sheet opens, so a sheet
  // never reopens at a height the user dragged it to in a different context.
  useEffect(() => {
    if (open) setSnapIndex(0)
  }, [open])

  const heightFor = useCallback(
    (index: number) => `${Math.round((snapPoints[index] ?? 0.9) * 100)}dvh`,
    [snapPoints],
  )

  const endDrag = useCallback(
    (commit: boolean) => {
      const node = sheetRef.current
      const state = drag.current
      drag.current = null
      if (!node || !state) return

      node.style.transition = ""
      node.style.willChange = ""

      if (!commit) {
        node.style.transform = ""
        return
      }

      const elapsed = Math.max(1, state.lastTime - state.startTime)
      const velocity = (state.lastY - state.startY) / elapsed
      const threshold = node.offsetHeight * DISMISS_DISTANCE_RATIO

      const shouldClose = state.offset > threshold || velocity > DISMISS_VELOCITY
      if (shouldClose) {
        onOpenChange(false)
        node.style.transform = ""
        return
      }

      // Dragged up past the midpoint of the gap to the next snap point, so
      // promote the sheet instead of springing back.
      const draggedUp = state.offset < -60
      if (draggedUp && snapIndex < snapPoints.length - 1) setSnapIndex(snapIndex + 1)

      node.style.transform = ""
    },
    [onOpenChange, snapIndex, snapPoints.length],
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Only start a drag from the grabber, or from the scroll area when it is
    // already at the top. Otherwise a downward swipe should scroll content.
    const fromGrabber = event.currentTarget.dataset.grabber === "true"
    if (!fromGrabber && (scrollRef.current?.scrollTop ?? 0) > 0) return
    if (prefersReducedMotion()) return

    /**
     * Pointer capture keeps move events coming if the finger leaves the element
     * mid-drag. It is an improvement, not a requirement — the drag still works
     * without it — so a platform that lacks or refuses it must not take the
     * whole gesture down with an exception.
     */
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Capture denied; the drag continues with element-local events.
    }

    const now = performance.now()
    drag.current = {
      active: true,
      startY: event.clientY,
      startTime: now,
      lastY: event.clientY,
      lastTime: now,
      offset: 0,
    }
    const node = sheetRef.current
    if (node) {
      node.style.transition = "none"
      node.style.willChange = "transform"
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current
    const node = sheetRef.current
    if (!state?.active || !node) return

    const delta = event.clientY - state.startY
    state.lastY = event.clientY
    state.lastTime = performance.now()
    // Upward drag is resisted so the sheet feels anchored once it is at its
    // tallest snap point, rather than detaching from the finger.
    const resisted = delta < 0 ? delta * 0.35 : delta
    state.offset = resisted
    node.style.transform = `translate3d(0, ${resisted}px, 0)`
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-[55] bg-ink/70 backdrop-blur-md",
            "data-[state=open]:animate-scrim-in",
          )}
        />
        <Dialog.Content
          ref={sheetRef}
          aria-describedby={description ? undefined : ""}
          style={{ height: heightFor(snapIndex) }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-[56] flex flex-col",
            "mx-auto w-full max-w-[42rem]",
            "rounded-t-card bg-ink-2",
            "shadow-[0_-24px_80px_-32px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.06)]",
            "transition-[height] duration-500 ease-glide",
            "data-[state=open]:animate-sheet-in",
            "focus:outline-none",
            className,
          )}
        >
          {/* Grabber. The hit area is 44px tall even though the visible bar is
              4px, which is the difference between a usable and a decorative
              drag handle on touch. */}
          <div
            data-grabber="true"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => endDrag(true)}
            onPointerCancel={() => endDrag(false)}
            className="flex h-11 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          >
            <span aria-hidden="true" className="h-1 w-10 rounded-full bg-white/20" />
          </div>

          <div className="shrink-0 px-6 pb-4">
            <Dialog.Title className="text-[1.25rem] leading-tight font-medium tracking-[-0.02em] text-fg">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-1.5 text-[0.88rem] text-muted">
                {description}
              </Dialog.Description>
            ) : null}
          </div>

          <div
            ref={scrollRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => endDrag(true)}
            onPointerCancel={() => endDrag(false)}
            className="scrollbar-slim min-h-0 flex-1 overflow-y-auto overscroll-contain px-6"
          >
            {children}
          </div>

          {footer ? (
            <div
              className="hairline-t shrink-0 px-6 pt-4"
              // The sheet sits flush to the bottom edge, so its own padding is
              // what keeps the primary action clear of the home indicator.
              style={{ paddingBottom: "calc(1rem + var(--safe-bottom))" }}
            >
              {footer}
            </div>
          ) : (
            <div style={{ height: "var(--safe-bottom)" }} aria-hidden="true" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export const SheetTrigger = Dialog.Trigger
export const SheetClose = Dialog.Close
