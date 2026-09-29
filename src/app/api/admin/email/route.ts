import { readEmailStatus, saveEmailConfiguration } from "@/features/admin/email/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

/**
 * How outgoing email is sent. GET never returns the password or API key, not even
 * masked. Validation and permission errors are shaped by `route()`.
 */

async function GETHandler() {
  await requireSuperAdmin()
  return Response.json({ email: await readEmailStatus() })
}

async function PUTHandler(request: Request) {
  const admin = await requireSuperAdmin()
  return Response.json({ email: await saveEmailConfiguration(await request.json().catch(() => null), admin) })
}

export const GET = route(GETHandler)
export const PUT = route(PUTHandler)
