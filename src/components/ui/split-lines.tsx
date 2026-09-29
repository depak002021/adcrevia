"use client"

import { useRef, type ElementType, type ReactNode } from "react"

import { cancelRevealFailsafe, gsap, useGSAP, SplitText } from "@/lib/gsap"
import { cn } from "@/lib/cn"

/**
 * Line-by-line mask reveal for display headlines.
 *
 * Splitting waits for `document.fonts.ready` so the line breaks are measured
 * against the real Geist metrics rather than the fallback face — otherwise the
 * mask is cut at the wrong positions and lines clip mid-glyph on first paint.
 *
 * `autoSplit` re-splits on resize, which is what keeps the effect correct when a
 * headline reflows between breakpoints.
 */
export function SplitLines({
  children,
  className,
  as: Tag = "h2",
  delay = 0,
  start = "top 84%",
  immediate = false,
}: {
  children: ReactNode
  className?: string
  as?: ElementType
  delay?: number
  start?: string
  /** Play on load rather than on scroll. Used for the hero. */
  immediate?: boolean
}) {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const element = ref.current
      if (!element) return

      cancelRevealFailsafe()

      let split: SplitText | null = null
      let tween: gsap.core.Tween | null = null
      let cancelled = false

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(element, { opacity: 1 })
        return
      }

      const run = () => {
        if (cancelled || !ref.current) return

        split = SplitText.create(ref.current, {
          type: "lines",
          mask: "lines",
          linesClass: "split-line",
          autoSplit: true,
        })

        gsap.set(ref.current, { opacity: 1 })

        tween = gsap.from(split.lines, {
          yPercent: 118,
          duration: 1.15,
          ease: "expo.out",
          stagger: 0.085,
          delay,
          ...(immediate ? {} : { scrollTrigger: { trigger: ref.current, start } }),
        })
      }

      if (document.fonts && document.fonts.status !== "loaded") {
        document.fonts.ready.then(run)
      } else {
        run()
      }

      return () => {
        cancelled = true
        tween?.kill()
        split?.revert()
      }
    },
    { scope: ref },
  )

  return (
    <Tag ref={ref} data-split="" className={cn(className)}>
      {children}
    </Tag>
  )
}
