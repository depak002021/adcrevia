import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"

async function GETHandler(_request: Request, context: RouteContext<"/api/images/[imageId]">) {
  const user = await requireUser()
  const { imageId } = await context.params
  const image = await getPrisma().generatedImage.findFirst({
    where: { id: imageId, project: { userId: user.id } },
    select: { id: true, projectId: true, position: true, status: true, url: true, width: true, height: true, safeErrorCode: true, evaluation: true },
  })
  if (!image) return Response.json({ error: "Image not found." }, { status: 404 })
  return Response.json(image)
}

export const GET = route(GETHandler)
