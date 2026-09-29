import { getPrisma } from "@/lib/db/prisma"

import { summarizeSpend, type CostRow, type SpendSummary } from "./summary"

type Scope = { projectId?: string; userId?: string }

async function costRows(scope: Scope): Promise<CostRow[]> {
  const where = {
    status: { in: ["SUCCEEDED" as const, "FAILED" as const] },
    ...(scope.projectId ? { projectId: scope.projectId } : {}),
    ...(scope.userId ? { project: { userId: scope.userId } } : {}),
  }
  const db = getPrisma()
  const [images, videos] = await Promise.all([
    db.imageGenerationLog.findMany({ where, select: { status: true, provider: true, projectId: true, details: true } }),
    db.videoGenerationLog.findMany({ where, select: { status: true, provider: true, projectId: true, details: true } }),
  ])
  return [...images.map((row) => ({ ...row, kind: "image" as const })), ...videos.map((row) => ({ ...row, kind: "video" as const }))]
}

/** What one project has cost so far (owner-checked). */
export async function projectSpend(projectId: string, userId: string): Promise<SpendSummary | null> {
  const owned = await getPrisma().project.findFirst({ where: { id: projectId, userId }, select: { id: true } })
  if (!owned) return null
  return summarizeSpend(await costRows({ projectId }))
}

/** Everything, plus the most expensive projects — for the admin console. */
export async function overallSpend(): Promise<SpendSummary & { byProject: Array<{ projectId: string; name: string; usd: number }> }> {
  const rows = await costRows({})
  const perProject = new Map<string, CostRow[]>()
  for (const row of rows) perProject.set(row.projectId, [...(perProject.get(row.projectId) ?? []), row])
  const names = await getPrisma().project.findMany({ where: { id: { in: [...perProject.keys()] } }, select: { id: true, name: true } })
  const byProject = names
    .map((project) => ({ projectId: project.id, name: project.name, usd: summarizeSpend(perProject.get(project.id) ?? []).totalUsd }))
    .sort((a, b) => b.usd - a.usd)
  return { ...summarizeSpend(rows), byProject }
}
