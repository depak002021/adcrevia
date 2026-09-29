import { z } from "zod"

import { listCatalogProviderStatus, saveCatalogProviderKey } from "@/features/admin/providers/catalog-keys"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"

async function GETHandler(request: Request) {
  try {
    const admin = await requireSuperAdmin()
    const parsed = z.enum(["IMAGE", "VIDEO"]).safeParse(new URL(request.url).searchParams.get("kind"))
    if (!parsed.success) return Response.json({ error: "Provider kind is required." }, { status: 400 })
    return Response.json({ providers: await listCatalogProviderStatus(parsed.data, admin) })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}

async function POSTHandler(request: Request) {
  try {
    const admin = await requireSuperAdmin()
    const result = await saveCatalogProviderKey(await request.json().catch(() => null), admin)
    return Response.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    if (error && typeof error === "object" && "issues" in error) return Response.json({ error: "Enter a valid API key." }, { status: 400 })
    throw error
  }
}

export const GET = route(GETHandler)
export const POST = route(POSTHandler)
