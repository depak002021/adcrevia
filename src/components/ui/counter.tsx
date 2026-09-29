"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Count-up number that animates from 0 to `value` when it scrolls into view.
 * Eases out for a premium feel; respects reduced motion (shows the final value
 * immediately). `prefix`/`suffix` wrap the number (e.g. "+", "%").
 */
export function Counter({ value, durationMs = 1400, prefix = "", suffix = "", decimals = 0 }: { value: number; durationMs?: number; prefix?: string; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduce || typeof IntersectionObserver === "undefined") {
      setDisplay(value)
      return
    }
    let raf = 0
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs)
        const eased = 1 - Math.pow(1 - t, 3)
        setDisplay(value * eased)
        if (t < 1) raf = requestAnimationFrame(tick)
        else setDisplay(value)
      }
      raf = requestAnimationFrame(tick)
    }, { threshold: 0.4 })
    observer.observe(node)
    return () => { observer.disconnect(); cancelAnimationFrame(raf) }
  }, [value, durationMs])

  return <span ref={ref}>{prefix}{display.toFixed(decimals)}{suffix}</span>
}
