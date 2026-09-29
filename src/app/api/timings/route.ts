import { readExpectedTimes } from "@/features/timing/service"
import { requireUser } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

/** Typical render time per model, for the countdowns. */
async function GETHandler() {
  await requireUser()
  return Response.json(await readExpectedTimes(), { headers: { "cache-control": "private, max-age=300" } })
}

export const GET = route(GETHandler)
