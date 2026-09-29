import Link from "next/link"
import { Download, FolderOpen, Play } from "lucide-react"

import { costOf } from "@/features/costs/summary"
import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"

/** Portrait clips shown portrait, landscape shown landscape: no letterboxing. */
function shape(aspectRatio: string | null | undefined) {
  const [w, h] = (aspectRatio ?? "16:9").split(":").map(Number)
  return w && h ? `${w} / ${h}` : "16 / 9"
}

const usd = (value: number) => `$${value.toFixed(2)}`

export default async function VideosPage() {
  const user = await requireUser()
  const db = getPrisma()
  const [videos, reels] = await Promise.all([
    db.generatedVideo.findMany({
      where: { project: { userId: user.id } },
      orderBy: { createdAt: "desc" },
      include: {
        project: { select: { id: true, name: true } },
        sourceImage: { select: { url: true } },
        logs: { where: { status: { in: ["SUCCEEDED", "FAILED"] } }, select: { details: true } },
      },
    }),
    db.videoComposition.findMany({
      where: { status: "COMPLETED", url: { not: null }, project: { userId: user.id } },
      orderBy: { renderedAt: "desc" },
      select: { id: true, url: true, posterUrl: true, durationMs: true, aspectRatio: true, project: { select: { id: true, name: true } } },
    }),
  ])

  const empty = videos.length === 0 && reels.length === 0

  return (
    <main className="studio-page">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Motion library</p>
          <h1>Videos</h1>
          <p>Every reel and clip, ready to preview, download and post.</p>
        </div>
      </header>

      {empty ? (
        <section className="empty-studio">
          <h2>No videos yet.</h2>
          <p>Open a project, pick your best concepts and bring them to life.</p>
          <Link className="secondary-button" href="/dashboard/projects">Browse projects</Link>
        </section>
      ) : null}

      {reels.length ? (
        <section className="overview-section">
          <div className="overview-heading"><h2>Reels</h2></div>
          <div className="video-library">
            {reels.map((reel) => (
              <article key={reel.id}>
                <div className="video-frame" style={{ aspectRatio: shape(reel.aspectRatio) }}>
                  <video src={reel.url!} poster={reel.posterUrl ?? undefined} controls playsInline preload="metadata" />
                </div>
                <div className="video-meta">
                  <p>{reel.project.name}</p>
                  <span>Reel · {Math.round((reel.durationMs ?? 0) / 1000)}s · {reel.aspectRatio}</span>
                  <div className="video-actions">
                    <a href={`/api/compositions/${reel.id}/download`} download><Download size={14} aria-hidden /> Download</a>
                    <Link href={`/dashboard/projects/${reel.project.id}`}><FolderOpen size={14} aria-hidden /> Open project</Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {videos.length ? (
        <section className="overview-section">
          <div className="overview-heading"><h2>Clips</h2></div>
          <div className="video-library">
            {videos.map((video) => {
              const cost = video.logs.map((log) => costOf(log.details)).find((value) => value !== null) ?? null
              return (
                <article key={video.id}>
                  <div className="video-frame" style={{ aspectRatio: shape(video.aspectRatio) }}>
                    {video.status === "COMPLETED" && video.url ? (
                      <video src={video.url} poster={video.sourceImage.url ?? undefined} controls playsInline preload="metadata" />
                    ) : video.sourceImage.url ? (
                      <div className="video-poster">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={video.sourceImage.url} alt="" />
                        <span><Play size={16} aria-hidden /> {video.status === "FAILED" ? "failed" : "rendering"}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="video-meta">
                    <p>{video.project.name}</p>
                    <span>
                      {[video.provider, `${video.durationSeconds}s`, video.aspectRatio, video.motionStyle.replaceAll("_", " ").toLowerCase()].filter(Boolean).join(" · ")}
                      {cost !== null ? ` · ${cost === 0 && video.status === "FAILED" ? "not billed" : usd(cost)}` : ""}
                    </span>
                    <div className="video-actions">
                      {video.status === "COMPLETED" && video.url ? (
                        <a href={`/api/videos/${video.id}/download`} download><Download size={14} aria-hidden /> Download</a>
                      ) : null}
                      <Link href={`/dashboard/projects/${video.project.id}`}><FolderOpen size={14} aria-hidden /> Open project</Link>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ) : null}
    </main>
  )
}
