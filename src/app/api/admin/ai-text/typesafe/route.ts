import { disableTypeSafeConfiguration, saveTypeSafeConfiguration } from "@/features/admin/ai-text/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

/**
 * The TypeSafe Jev credential for the decision layer. Write-only: the key is
 * encrypted at rest and never returned, not even masked.
 */

async function PUTHandler(request: Request) {
  const admin = await requireSuperAdmin()
  return Response.json({ aiText: await saveTypeSafeConfiguration(await request.json().catch(() => null), admin) })
}

async function DELETEHandler() {
  const admin = await requireSuperAdmin()
  return Response.json({ aiText: await disableTypeSafeConfiguration(admin) })
}

export const PUT = route(PUTHandler)
export const DELETE = route(DELETEHandler)
