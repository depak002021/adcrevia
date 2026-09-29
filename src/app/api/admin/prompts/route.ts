import { listPromptKeys } from "@/features/admin/prompts/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

/** Every editable prompt, with which version is live. */
async function GETHandler() {
  await requireSuperAdmin()
  return Response.json({ prompts: await listPromptKeys() })
}

export const GET = route(GETHandler)
