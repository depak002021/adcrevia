import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"

async function GETHandler(_request: Request, context: RouteContext<"/api/videos/[videoId]">) {
  const user = await requireUser()
  const { videoId } = await context.params
  const video = await getPrisma().generatedVideo.findFirst({
    where: { id: videoId, project: { userId: user.id } },
    select: { id: true, projectId: true, status: true, motionStyle: true, instructions: true, durationSeconds: true, aspectRatio: true, url: true, mimeType: true, safeErrorCode: true, createdAt: true, completedAt: true, sourceImage: { select: { id: true, url: true } } },
  })
  if (!video) return Response.json({ error: "Video not found." }, { status: 404 })
  return Response.json(video)
}

export const GET = route(GETHandler)
