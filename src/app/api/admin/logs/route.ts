import { z } from "zod"

import { listGenerationLogs } from "@/features/admin/logs/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

async function GETHandler(request: Request) {
  await requireSuperAdmin()
  const kind = z.enum(["IMAGE", "VIDEO"]).safeParse(new URL(request.url).searchParams.get("kind") ?? "IMAGE")
  if (!kind.success) return Response.json({ error: "Invalid log kind." }, { status: 400 })
  return Response.json({ logs: await listGenerationLogs(kind.data) })
}

export const GET = route(GETHandler)
