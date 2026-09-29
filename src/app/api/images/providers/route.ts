import { requireUser } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { listAvailableImageProviders } from "@/lib/providers/configuration"
import { route } from "@/lib/http/route"

/**
 * Lists the image providers the signed-in user can choose from. Returns only
 * provider name, model, label, and which is active — never any credential.
 */
async function GETHandler() {
  try {
    await requireUser()
    const providers = await listAvailableImageProviders()
    return Response.json({ providers })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    return Response.json({ providers: [] }, { status: 200 })
  }
}

export const GET = route(GETHandler)
