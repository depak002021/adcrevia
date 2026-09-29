import { z } from "zod"

import { activatePromptVersion } from "@/features/admin/prompts/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"

/**
 * Make one stored version live.
 *
 * Under `[key]` rather than at the version's own id so the URL says what is being
 * changed. The id is enough on its own, and the service checks that the version exists
 * before touching anything.
 */

const schema = z.object({ versionId: z.string().cuid() })

async function POSTHandler(request: Request) {
  const admin = await requireSuperAdmin()

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Choose a version." }, { status: 400 })

  try {
    return Response.json({ version: await activatePromptVersion(parsed.data.versionId, admin) })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}

export const POST = route(POSTHandler)
