import { z } from "zod"

import { isRegistrationOpen, setRegistrationOpen } from "@/features/auth/registration"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

async function GETHandler() {
  await requireSuperAdmin()
  return Response.json({ open: await isRegistrationOpen() })
}

async function PUTHandler(request: Request) {
  await requireSuperAdmin()
  const parsed = z.object({ open: z.boolean() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Choose open or closed." }, { status: 400 })
  return Response.json({ open: await setRegistrationOpen(parsed.data.open) })
}

export const GET = route(GETHandler)
export const PUT = route(PUTHandler)
