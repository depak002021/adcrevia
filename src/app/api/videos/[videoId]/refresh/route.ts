import { refreshVideoStatus } from "@/features/videos/service"
import { requireUser } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

export const maxDuration = 60

const CONFIG_ERROR_MESSAGES = new Set([
  "RUNWAYML_API_SECRET is required",
  "BFL_API_KEY is required",
  "ARK_API_KEY is required",
  "R2_STORAGE_CONFIG_REQUIRED",
])

async function POSTHandler(_request: Request, context: RouteContext<"/api/videos/[videoId]/refresh">) {
  const user = await requireUser()
  const { videoId } = await context.params
  try {
    return Response.json({ video: await refreshVideoStatus(videoId, user.id) })
  } catch (error) {
    if (error instanceof Error && CONFIG_ERROR_MESSAGES.has(error.message)) {
      return Response.json({ error: "Video provider or storage is not configured yet." }, { status: 503 })
    }
    // Any upstream failure is reported as a safe, body-free 502; provider
    // polling URLs, keys, and raw responses never leave the service layer.
    return Response.json({ error: "Video status is temporarily unavailable." }, { status: 502 })
  }
}

export const POST = route(POSTHandler)
