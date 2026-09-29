import { videoFileName } from "@/features/videos/download-name"
import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"
import { createStorageProvider } from "@/lib/storage/runtime"

/**
 * Download a finished reel/edit — or one platform version of it (`?preset=reels`) —
 * as a named file.
 *
 * Served from the app's own origin: the media host is another origin with no CORS,
 * so the share sheet could neither fetch the file for the phone's native share nor
 * make `<a download>` save it (browsers ignore it across origins).
 */
async function GETHandler(request: Request, context: RouteContext<"/api/compositions/[compositionId]/download">) {
  const user = await requireUser()
  const { compositionId } = await context.params
  const preset = new URL(request.url).searchParams.get("preset")
  const composition = await getPrisma().videoComposition.findFirst({
    where: { id: compositionId, status: "COMPLETED", project: { userId: user.id } },
    select: {
      url: true,
      durationMs: true,
      aspectRatio: true,
      project: { select: { name: true } },
      renders: preset ? { where: { preset, status: "COMPLETED" }, select: { url: true, aspectRatio: true }, take: 1 } : false,
    },
  })
  const version = preset ? composition?.renders?.[0] : null
  const url = preset ? version?.url : composition?.url
  if (!composition || !url) return Response.json({ error: "That video is not available to download." }, { status: 404 })

  const file = await (await createStorageProvider()).readByUrl?.(url).catch(() => null)
  if (!file) return Response.redirect(url, 302)
  const label = preset ? `${composition.project.name} ${preset.replace(/_/g, " ")}` : `${composition.project.name} reel`
  const name = videoFileName(label, Math.round((composition.durationMs ?? 0) / 1000), version?.aspectRatio ?? composition.aspectRatio)
  return new Response(file.bytes as unknown as BodyInit, {
    headers: {
      "content-type": "video/mp4",
      "content-length": String(file.bytes.byteLength),
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
    },
  })
}

export const GET = route(GETHandler)
