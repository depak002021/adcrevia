"use client"

import { useRef, type ElementType, type ReactNode } from "react"

import { cancelRevealFailsafe, gsap, useGSAP } from "@/lib/gsap"
import { cn } from "@/lib/cn"

/**
 * Scroll entry motion, shared by the marketing site and the studio.
 *
 * Replaces a hand-rolled IntersectionObserver version. Moving to GSAP is not
 * about capability — the observer worked — but about having one animation engine
 * and one scroll position in the bundle. Two engines means ScrollTrigger's
 * pinned sections and a separate observer disagree about where the page is.
 *
 * Transform and opacity only, so it stays on the compositor, and it collapses to
 * a plain static render under reduced motion via `gsap.matchMedia`.
 *
 * Note on units: `delay` and `stagger` are SECONDS, matching GSAP. The previous
 * component took milliseconds.
 */
export function Reveal({
  children,
  className,
  group = false,
  delay = 0,
  stagger = 0.08,
  y = 26,
  start = "top 82%",
  as: Tag = "div",
}: {
  children: ReactNode
  className?: string
  /** Animate direct children in sequence instead of the wrapper itself. */
  group?: boolean
  delay?: number
  stagger?: number
  y?: number
  start?: string
  as?: ElementType
}) {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const element = ref.current
      if (!element) return

      // Confirms the animation bundle arrived, so the layout's failsafe does not
      // un-hide content partway through the entrance.
      cancelRevealFailsafe()

      const targets = group ? Array.from(element.children) : element
      const media = gsap.matchMedia()

      media.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(targets, { opacity: 1, y: 0 })
      })

      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          targets,
          { opacity: 0, y, scale: 0.995 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.95,
            ease: "expo.out",
            delay,
            stagger: group ? stagger : 0,
            scrollTrigger: { trigger: element, start },
          },
        )
      })

      return () => media.revert()
    },
    { scope: ref },
  )

  return (
    <Tag
      ref={ref}
      className={cn(className)}
      {...(group ? { "data-reveal-group": "" } : { "data-reveal": "" })}
    >
      {children}
    </Tag>
  )
}
