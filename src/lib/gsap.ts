"use client"

import { gsap } from "gsap"
import { useGSAP } from "@gsap/react"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { ScrollToPlugin } from "gsap/ScrollToPlugin"
import { SplitText } from "gsap/SplitText"
import { Flip } from "gsap/Flip"

/**
 * Single GSAP entry point for the whole product.
 *
 * Registering here rather than per-component means a plugin is registered
 * exactly once, and every animated component imports from one module so the
 * bundle never ends up with two GSAP instances (which silently breaks
 * ScrollTrigger's shared scroll position).
 *
 * `Flip` is included for the studio: reordering scenes in the storyboard and
 * the selection tray animates from the real before/after layout instead of
 * guessing offsets.
 */
gsap.registerPlugin(useGSAP, ScrollTrigger, ScrollToPlugin, SplitText, Flip)

export { gsap, useGSAP, ScrollTrigger, SplitText, Flip }

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * Anchor navigation. Uses ScrollToPlugin rather than CSS `scroll-behavior`
 * because native smooth scrolling fights ScrollTrigger's pinned sections.
 */
export function scrollToId(id: string) {
  const element = document.getElementById(id)
  if (!element) return
  const y = element.getBoundingClientRect().top + window.scrollY - 8

  if (prefersReducedMotion()) {
    window.scrollTo(0, y)
    return
  }

  gsap.to(window, { duration: 1.05, ease: "power3.inOut", scrollTo: { y, autoKill: true } })
}

/**
 * Clears the reveal failsafe set in the root layout. Called by the first
 * animation component to mount, confirming the bundle arrived, so the failsafe
 * never un-hides content mid-animation.
 */
export function cancelRevealFailsafe() {
  const timer = (window as { __adcreviaRevealFailsafe?: ReturnType<typeof setTimeout> })
    .__adcreviaRevealFailsafe
  if (timer) clearTimeout(timer)
}
