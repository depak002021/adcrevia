import { readAiTextStatus, saveTextModels } from "@/features/admin/ai-text/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

/**
 * Which OpenAI models write, converse and classify. Nothing here is secret.
 * Validation and permission errors are shaped by `route()` (fields per input).
 */

async function GETHandler() {
  await requireSuperAdmin()
  return Response.json({ aiText: await readAiTextStatus() })
}

async function PUTHandler(request: Request) {
  const admin = await requireSuperAdmin()
  return Response.json({ aiText: await saveTextModels(await request.json().catch(() => null), admin) })
}

export const GET = route(GETHandler)
export const PUT = route(PUTHandler)
