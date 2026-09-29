"use client"

import { useEffect, useState } from "react"

import type { SpendSummary } from "@/features/costs/summary"

const usd = (value: number) => `$${value.toFixed(2)}`

/**
 * What this project has cost so far, summed from its generation logs: every
 * finished image and video at the price its provider reported.
 */
export function ProjectSpend({ projectId, initial, refreshKey }: { projectId: string; initial: SpendSummary; /** Changes when a render finishes. */ refreshKey: string }) {
  const [spend, setSpend] = useState(initial)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/projects/${projectId}/spend`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { spend?: SpendSummary } | null) => {
        if (!cancelled && body?.spend) setSpend(body.spend)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey])

  if (spend.images.count + spend.videos.count === 0 && !spend.unpriced) return null
  return (
    <section aria-label="Project spend" className="mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-2xl border border-[var(--line)] px-4 py-3 text-[0.85rem] text-muted">
      <p>
        Spent so far <b className="text-[1.1rem] font-semibold text-fg">{usd(spend.totalUsd)}</b>
      </p>
      <p>Images <b className="text-fg">{usd(spend.images.usd)}</b> · {spend.images.count}</p>
      <p>Videos <b className="text-fg">{usd(spend.videos.usd)}</b> · {spend.videos.count}</p>
      {spend.byProvider.length > 1 ? (
        <p>{spend.byProvider.map((item) => `${item.provider} ${usd(item.usd)}`).join(" · ")}</p>
      ) : null}
      {spend.unpriced ? <p>{spend.unpriced} earlier render{spend.unpriced === 1 ? "" : "s"} not priced</p> : null}
    </section>
  )
}
