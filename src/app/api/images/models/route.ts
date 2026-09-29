import { requireUser } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { listSelectableImageModels } from "@/lib/providers/configuration"
import { route } from "@/lib/http/route"

/**
 * Full image model catalog for the signed-in user. Every catalog model is
 * listed; `configured` marks the ones that can actually generate (live provider
 * with a saved credential), and `active` marks the current default. No secrets.
 */
async function GETHandler() {
  try {
    await requireUser()
    const models = await listSelectableImageModels()
    return Response.json({ models })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    return Response.json({ models: [] }, { status: 200 })
  }
}

export const GET = route(GETHandler)
