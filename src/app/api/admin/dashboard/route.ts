import { getAdminDashboardSummary } from "@/features/admin/dashboard/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

async function GETHandler() { await requireSuperAdmin(); return Response.json(await getAdminDashboardSummary()) }

export const GET = route(GETHandler)
