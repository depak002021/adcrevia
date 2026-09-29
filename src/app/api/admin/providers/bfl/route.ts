import { saveBflConfigurations } from "@/features/admin/providers/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

async function POSTHandler(request: Request) {
  const admin = await requireSuperAdmin()
  try {
    const configurations = await saveBflConfigurations(await request.json().catch(() => null), admin)
    return Response.json({ ids: configurations.map(({ id }) => id) }, { status: 201 })
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      return Response.json({ error: "Check the BFL provider settings." }, { status: 400 })
    }
    throw error
  }
}

export const POST = route(POSTHandler)
