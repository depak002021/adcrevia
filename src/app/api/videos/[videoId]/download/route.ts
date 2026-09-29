import { videoFileName } from "@/features/videos/download-name"
import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"
import { createStorageProvider } from "@/lib/storage/runtime"

/**
 * Download a finished video as a file, for posting to social apps.
 *
 * The stored file lives on the media host, a different origin from the app, and
 * browsers ignore `<a download>` across origins: tapping "Download" on a phone just
 * opened the video in a tab. Served from here with `Content-Disposition: attachment`
 * it saves as a file named after the project, on every browser.
 */
async function GETHandler(_request: Request, context: RouteContext<"/api/videos/[videoId]/download">) {
  const user = await requireUser()
  const { videoId } = await context.params
  const video = await getPrisma().generatedVideo.findFirst({
    where: { id: videoId, status: "COMPLETED", project: { userId: user.id } },
    select: { url: true, durationSeconds: true, aspectRatio: true, project: { select: { name: true } } },
  })
  if (!video?.url) return Response.json({ error: "That video is not available to download." }, { status: 404 })

  const storage = await createStorageProvider()
  const file = await storage.readByUrl?.(video.url).catch(() => null)
  // Local-disk storage (development) or an unreadable object: fall back to the URL.
  if (!file) return Response.redirect(video.url, 302)

  const name = videoFileName(video.project.name, video.durationSeconds, video.aspectRatio)
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
