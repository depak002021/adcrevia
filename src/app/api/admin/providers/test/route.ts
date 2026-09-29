import { testProviderConfiguration } from "@/features/admin/providers/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

async function POSTHandler(request: Request) {
  const admin = await requireSuperAdmin()
  try {
    return Response.json(await testProviderConfiguration(await request.json().catch(() => null), admin))
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) return Response.json({ error: "Check the provider settings." }, { status: 400 })
    throw error
  }
}

export const POST = route(POSTHandler)
