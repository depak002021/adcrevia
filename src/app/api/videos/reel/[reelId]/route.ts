import { videoErrorResponse } from "@/features/videos/errors"
import { readReel } from "@/features/videos/reel"
import { requireUser } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

/** Progress of a reel: each clip, then the joined result. */
async function GETHandler(_request: Request, context: RouteContext<"/api/videos/reel/[reelId]">) {
  const user = await requireUser()
  const { reelId } = await context.params
  if (!/^[0-9a-f-]{36}$/.test(reelId)) return Response.json({ error: "Reel not found." }, { status: 404 })
  try {
    return Response.json(await readReel(reelId, user.id))
  } catch (error) {
    return videoErrorResponse(error, "Reel status is temporarily unavailable.")
  }
}

export const GET = route(GETHandler)
