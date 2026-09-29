import { getPrisma } from "@/lib/db/prisma"

import { median, type ExpectedTimes } from "./expected"

const SAMPLE = 20
const CACHE_MS = 5 * 60_000
let cached: { at: number; value: ExpectedTimes } | null = null

/** Median duration of each model's latest successful renders, from the logs. */
export async function readExpectedTimes(): Promise<ExpectedTimes> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  const db = getPrisma()
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000)
  const [images, videos] = await Promise.all([
    db.imageGenerationLog.findMany({
      where: { status: "SUCCEEDED", createdAt: { gte: since }, durationMs: { not: null }, model: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 400,
      select: { model: true, durationMs: true },
    }),
    db.videoGenerationLog.findMany({
      where: { status: "SUCCEEDED", createdAt: { gte: since }, durationMs: { not: null }, model: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 400,
      select: { model: true, durationMs: true },
    }),
  ])
  const byModel = (rows: Array<{ model: string | null; durationMs: number | null }>) => {
    const groups = new Map<string, number[]>()
    for (const row of rows) {
      if (!row.model || row.durationMs === null) continue
      const list = groups.get(row.model) ?? []
      if (list.length < SAMPLE) list.push(row.durationMs)
      groups.set(row.model, list)
    }
    const out: Record<string, number> = {}
    for (const [model, list] of groups) {
      const value = median(list)
      if (value !== null) out[model] = value
    }
    return out
  }
  const value = { images: byModel(images), videos: byModel(videos) }
  cached = { at: Date.now(), value }
  return value
}
