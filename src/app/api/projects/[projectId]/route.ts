import { z } from "zod"

import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"

async function GETHandler(_request: Request, context: RouteContext<"/api/projects/[projectId]">) {
  const user = await requireUser()
  const { projectId } = await context.params
  const project = await getPrisma().project.findFirst({
    where: { id: projectId, userId: user.id },
    include: {
      prompt: true,
      directions: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" }, include: { evaluation: true } },
      imageSelections: { orderBy: { position: "asc" } },
      videos: { orderBy: { createdAt: "desc" } },
    },
  })
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 })
  return Response.json({ ...project, imageSelection: project.imageSelections[0] ?? null })
}

async function PATCHHandler(request: Request, context: RouteContext<"/api/projects/[projectId]">) {
  const user = await requireUser()
  const { projectId } = await context.params
  const parsed = z.object({ name: z.string().trim().min(2).max(100) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Enter a project name." }, { status: 400 })
  const result = await getPrisma().project.updateMany({ where: { id: projectId, userId: user.id }, data: { name: parsed.data.name } })
  if (result.count !== 1) return Response.json({ error: "Project not found." }, { status: 404 })
  return Response.json({ ok: true })
}

async function DELETEHandler(_request: Request, context: RouteContext<"/api/projects/[projectId]">) {
  const user = await requireUser()
  const { projectId } = await context.params
  const result = await getPrisma().project.deleteMany({ where: { id: projectId, userId: user.id } })
  if (result.count !== 1) return Response.json({ error: "Project not found." }, { status: 404 })
  return new Response(null, { status: 204 })
}

export const GET = route(GETHandler)
export const PATCH = route(PATCHHandler)
export const DELETE = route(DELETEHandler)
