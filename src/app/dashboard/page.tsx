import Link from "next/link"
import { ArrowRight, Clapperboard, Download, FolderKanban, ImageIcon, Sparkles } from "lucide-react"

import { ProjectCard } from "@/components/dashboard/project-card"
import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"

/**
 * The studio overview: real totals, the projects to continue, and the latest
 * finished videos and reels, ready to download. (It used to be a fixed placeholder
 * that showed zeros whatever the user had made.)
 */
export default async function DashboardPage() {
  const user = await requireUser()
  const db = getPrisma()
  const [projectCount, imageCount, videoCount, reelCount, recent, videos, reels] = await Promise.all([
    db.project.count({ where: { userId: user.id } }),
    db.generatedImage.count({ where: { status: "COMPLETED", project: { userId: user.id } } }),
    db.generatedVideo.count({ where: { status: "COMPLETED", project: { userId: user.id } } }),
    db.videoComposition.count({ where: { status: "COMPLETED", project: { userId: user.id } } }),
    db.project.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { id: true, name: true, status: true, updatedAt: true, images: { where: { status: "COMPLETED" }, orderBy: { position: "asc" }, take: 1, select: { url: true } }, _count: { select: { images: true, videos: true } } },
    }),
    db.generatedVideo.findMany({
      where: { status: "COMPLETED", url: { not: null }, project: { userId: user.id } },
      orderBy: { completedAt: "desc" },
      take: 4,
      select: { id: true, url: true, durationSeconds: true, aspectRatio: true, provider: true, project: { select: { name: true } } },
    }),
    db.videoComposition.findMany({
      where: { status: "COMPLETED", url: { not: null }, project: { userId: user.id } },
      orderBy: { renderedAt: "desc" },
      take: 4,
      select: { id: true, url: true, durationMs: true, aspectRatio: true, project: { select: { name: true } } },
    }),
  ])

  const latest = [
    ...reels.map((reel) => ({ key: `r-${reel.id}`, url: reel.url!, label: "Reel", detail: `${Math.round((reel.durationMs ?? 0) / 1000)}s · ${reel.aspectRatio}`, project: reel.project.name, download: `/api/compositions/${reel.id}/download` })),
    ...videos.map((video) => ({ key: `v-${video.id}`, url: video.url!, label: video.provider ?? "Video", detail: `${video.durationSeconds}s · ${video.aspectRatio}`, project: video.project.name, download: `/api/videos/${video.id}/download` })),
  ].slice(0, 4)

  return (
    <main className="studio-page">
      <header className="studio-header">
        <div><p className="eyebrow">Creative command center</p><h1>Turn products into campaigns.</h1></div>
        <Link className="primary-button" href="/dashboard/create"><Sparkles size={17} /> New creation</Link>
      </header>

      {projectCount === 0 ? (
        <section className="creation-banner">
          <div><span className="step-chip">01 · Brief</span><h2>Start with the product. We’ll build the world around it.</h2><p>Paste a product link or upload photos, generate campaign images, then turn them into videos and reels.</p></div>
          <Link href="/dashboard/create">Open creative brief <ArrowRight size={17} /></Link>
        </section>
      ) : null}

      <section className="metric-grid" aria-label="Studio totals">
        <article><FolderKanban /><p>Projects</p><strong>{projectCount}</strong><span>{projectCount ? "Campaigns in your studio" : "Ready for your first brief"}</span></article>
        <article><ImageIcon /><p>Generated images</p><strong>{imageCount}</strong><span>Finished campaign concepts</span></article>
        <article><Clapperboard /><p>Videos &amp; reels</p><strong>{videoCount + reelCount}</strong><span>{reelCount ? `${videoCount} clips · ${reelCount} reel${reelCount === 1 ? "" : "s"}` : "Rendered from your concepts"}</span></article>
      </section>

      {projectCount === 0 ? (
        <section className="empty-studio"><div className="empty-orbit"><Sparkles /></div><h2>Your studio is ready.</h2><p>Create your first project and your latest campaign work will appear here.</p><Link className="secondary-button" href="/dashboard/create">Create first project</Link></section>
      ) : (
        <>
          <section className="overview-section">
            <div className="overview-heading"><h2>Continue where you left off</h2><Link href="/dashboard/projects">All projects <ArrowRight size={15} /></Link></div>
            <div className="project-grid">{recent.map((project) => <ProjectCard key={project.id} project={project} />)}</div>
          </section>

          {latest.length ? (
            <section className="overview-section">
              <div className="overview-heading"><h2>Latest videos</h2><Link href="/dashboard/videos">All videos <ArrowRight size={15} /></Link></div>
              <div className="overview-videos">
                {latest.map((item) => (
                  <article key={item.key}>
                    <video src={item.url} controls playsInline preload="metadata" />
                    <div>
                      <p>{item.project}</p>
                      <span>{item.label} · {item.detail}</span>
                      <a href={item.download} download><Download size={14} /> Download</a>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </main>
  )
}
