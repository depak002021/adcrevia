import { z } from "zod"

import { listMaskedProviders, saveProviderConfiguration } from "@/features/admin/providers/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

async function GETHandler(request: Request) {
  await requireSuperAdmin()
  const parsed = z.enum(["IMAGE", "VIDEO"]).safeParse(new URL(request.url).searchParams.get("kind"))
  if (!parsed.success) return Response.json({ error: "Provider kind is required." }, { status: 400 })
  return Response.json({ providers: await listMaskedProviders(parsed.data) })
}

async function POSTHandler(request: Request) {
  const admin = await requireSuperAdmin()
  try {
    const provider = await saveProviderConfiguration(await request.json().catch(() => null), admin)
    return Response.json({ id: provider.id }, { status: 201 })
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) return Response.json({ error: "Check the provider settings." }, { status: 400 })
    throw error
  }
}

export const GET = route(GETHandler)
export const POST = route(POSTHandler)
