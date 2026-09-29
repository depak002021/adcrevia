import { z } from "zod"

import { getGenerationPolicy, saveGenerationPolicy } from "@/features/admin/settings/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

const validationMessage = "Default images must be a whole number from 1 to 10."

async function GETHandler() {
  await requireSuperAdmin()
  return Response.json(await getGenerationPolicy())
}

async function PUTHandler(request: Request) {
  const admin = await requireSuperAdmin()
  try {
    return Response.json(await saveGenerationPolicy(await request.json().catch(() => null), admin))
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: validationMessage }, { status: 400 })
    throw error
  }
}

export const GET = route(GETHandler)
export const PUT = route(PUTHandler)
