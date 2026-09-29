import { z } from "zod"

import { addProductPhoto, listProductPhotos, removeProductPhoto } from "@/features/projects/product-photos"
import { requireUser } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

type Context = RouteContext<"/api/projects/[projectId]/product-photos">

async function GETHandler(_request: Request, context: Context) {
  const user = await requireUser()
  const { projectId } = await context.params
  return Response.json(await listProductPhotos(projectId, user.id))
}

/** One photo per request (multipart field "photo"), so each stays under the proxy's limit. */
async function POSTHandler(request: Request, context: Context) {
  const user = await requireUser()
  const limit = await rateLimiter.check({ action: "product-photo-upload", identifier: user.id, limit: 30, windowSeconds: 60 * 10 })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)
  const { projectId } = await context.params
  const form = await request.formData().catch(() => null)
  const photo = form?.get("photo")
  if (!(photo instanceof File)) return Response.json({ error: "Choose a photo to upload." }, { status: 400 })
  return Response.json(await addProductPhoto(projectId, user.id, photo), { status: 201 })
}

async function DELETEHandler(request: Request, context: Context) {
  const user = await requireUser()
  const { projectId } = await context.params
  const { url } = z.object({ url: z.string().url().max(2048) }).parse(await request.json().catch(() => null))
  return Response.json(await removeProductPhoto(projectId, user.id, url))
}

export const GET = route(GETHandler)
export const POST = route(POSTHandler)
export const DELETE = route(DELETEHandler)
