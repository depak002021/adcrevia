import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"

async function POSTHandler(_request: Request, context: RouteContext<"/api/images/[imageId]/retry">) {
  const user = await requireUser()
  const { imageId } = await context.params
  const image = await getPrisma().generatedImage.findFirst({
    where: { id: imageId, status: "FAILED", project: { userId: user.id } },
    select: { id: true },
  })
  if (!image) return Response.json({ error: "Retryable image not found." }, { status: 404 })
  await getPrisma().generatedImage.update({ where: { id: image.id }, data: { status: "PENDING", safeErrorCode: null } })
  return Response.json({ ok: true })
}

export const POST = route(POSTHandler)
