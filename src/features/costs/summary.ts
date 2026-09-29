/**
 * Spend, summed from the generation logs — the single source of truth for what was
 * paid. Each finished image or video logs its cost from the provider's own figures
 * (see lib/costs/pricing.ts); this adds them up.
 *
 * A finished render with no recorded cost (made before costs were logged, or from a
 * provider that reports none) is counted as `unpriced` rather than as $0, so a total
 * is never silently understated.
 */

export type CostRow = {
  kind: "image" | "video"
  status: string
  provider: string
  projectId: string
  details: unknown
}

export type SpendSummary = {
  totalUsd: number
  images: { count: number; usd: number }
  videos: { count: number; usd: number }
  /** Finished renders whose cost was not recorded. */
  unpriced: number
  byProvider: Array<{ provider: string; usd: number; count: number }>
}

/** Terminal log rows carry the cost; "started" rows only an estimate. */
const TERMINAL = new Set(["SUCCEEDED", "FAILED"])

export function costOf(details: unknown): number | null {
  const value = details && typeof details === "object" ? (details as { costUsd?: unknown }).costUsd : null
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function summarizeSpend(rows: CostRow[]): SpendSummary {
  const summary: SpendSummary = { totalUsd: 0, images: { count: 0, usd: 0 }, videos: { count: 0, usd: 0 }, unpriced: 0, byProvider: [] }
  const providers = new Map<string, { usd: number; count: number }>()
  for (const row of rows) {
    if (!TERMINAL.has(row.status)) continue
    const cost = costOf(row.details)
    if (cost === null) {
      if (row.status === "SUCCEEDED") summary.unpriced += 1
      continue
    }
    const bucket = row.kind === "image" ? summary.images : summary.videos
    if (row.status === "SUCCEEDED") bucket.count += 1
    bucket.usd += cost
    summary.totalUsd += cost
    const provider = providers.get(row.provider) ?? { usd: 0, count: 0 }
    provider.usd += cost
    provider.count += row.status === "SUCCEEDED" ? 1 : 0
    providers.set(row.provider, provider)
  }
  const round = (value: number) => Math.round(value * 1000) / 1000
  summary.totalUsd = round(summary.totalUsd)
  summary.images.usd = round(summary.images.usd)
  summary.videos.usd = round(summary.videos.usd)
  summary.byProvider = [...providers.entries()]
    .map(([provider, value]) => ({ provider, usd: round(value.usd), count: value.count }))
    .sort((a, b) => b.usd - a.usd)
  return summary
}
