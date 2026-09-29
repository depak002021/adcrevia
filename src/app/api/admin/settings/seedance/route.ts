import { z } from "zod"

import { requireSuperAdmin } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"
import { SEEDANCE_AVAILABLE_KEY } from "@/lib/providers/configuration"

async function read() {
  const row = await getPrisma().systemSetting.findUnique({ where: { key: SEEDANCE_AVAILABLE_KEY } })
  return row?.value === true
}

async function GETHandler() {
  await requireSuperAdmin()
  return Response.json({ open: await read() })
}

async function PUTHandler(request: Request) {
  await requireSuperAdmin()
  const parsed = z.object({ open: z.boolean() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Choose available or not." }, { status: 400 })
  await getPrisma().systemSetting.upsert({
    where: { key: SEEDANCE_AVAILABLE_KEY },
    create: { key: SEEDANCE_AVAILABLE_KEY, value: parsed.data.open },
    update: { value: parsed.data.open },
  })
  return Response.json({ open: await read() })
}

export const GET = route(GETHandler)
export const PUT = route(PUTHandler)
