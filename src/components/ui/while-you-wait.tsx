"use client"

import { useEffect, useState } from "react"
import { Lightbulb } from "@phosphor-icons/react/dist/ssr"

/**
 * Something worth reading while a render runs: elapsed time against the usual time,
 * a rotating tip for making the ad perform, and the reassurance that leaving is safe.
 * Entirely local: no requests, no model calls.
 */

const TIPS = [
  "The first second decides the scroll. Lead with the product in motion, not a logo.",
  "Most feeds play muted. Captions and on-screen benefits carry the message without sound.",
  "Test three opening hooks with the same video: the hook moves results more than the edit.",
  "UGC-style clips usually out-perform polished ads on Reels and TikTok. Keep one of each.",
  "Put the product in a hand or on a person early: scale and use are what shoppers look for.",
  "9:16 fills the whole phone screen. Use 4:5 for the feed and 1:1 for marketplaces.",
  "Keep text away from the top and bottom 15% of a reel: the app's buttons cover it.",
  "Refresh ads every 2–3 weeks. A new opening shot is often enough to beat fatigue.",
  "A close-up of texture, print or stitching builds trust faster than a claim.",
  "End on the product and a single clear action: shop, try, or learn more.",
]

function clock(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function WhileYouWait({
  expectedMs,
  startedAt,
  extra,
}: {
  /** Typical time for this render (per-model median from the logs). */
  expectedMs: number
  /** When the work actually started, so a reload does not restart the clock. */
  startedAt?: number
  extra?: React.ReactNode
}) {
  const [origin, setOrigin] = useState(() => startedAt ?? Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length))

  useEffect(() => {
    if (startedAt && startedAt < origin) setOrigin(startedAt)
  }, [startedAt, origin])

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1_000)
    const rotate = window.setInterval(() => setTip((current) => (current + 1) % TIPS.length), 9_000)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(rotate)
    }
  }, [])

  const elapsedMs = Math.max(0, now - origin)
  const elapsed = Math.round(elapsedMs / 1000)
  const remaining = Math.max(0, Math.round((expectedMs - elapsedMs) / 1000))
  const overdue = elapsedMs > expectedMs * 1.2
  // Never claims 100% before the result is actually in.
  const progress = Math.min(95, (elapsedMs / Math.max(1, expectedMs)) * 100)

  return (
    <div className="while-you-wait" aria-live="off">
      <p className="while-you-wait-time">
        <b>{clock(elapsed)}</b> elapsed ·{" "}
        {overdue
          ? `taking longer than usual (typically ${clock(Math.round(expectedMs / 1000))}), still working`
          : remaining <= 5
            ? "almost there"
            : `about ${clock(remaining)} left`}
      </p>
      <div className="while-you-wait-bar" data-overdue={overdue || undefined} aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <p key={tip} className="while-you-wait-tip">
        <Lightbulb size={16} weight="fill" aria-hidden="true" />
        <span>{TIPS[tip]}</span>
      </p>
      <p className="while-you-wait-note">
        Safe to leave this page: it keeps rendering and appears in your library.{extra ? " " : ""}
        {extra}
      </p>
    </div>
  )
}
