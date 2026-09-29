import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"

export default async function GenerationsPage() {
  const user = await requireUser()
  const images = await getPrisma().generatedImage.findMany({ where: { project: { userId: user.id }, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, include: { project: { select: { name: true } }, evaluation: true } })
  return <main className="studio-page"><header className="studio-header"><div><p className="eyebrow">Visual archive</p><h1>Generated images</h1><p>Every completed concept across your private campaign workspace.</p></div></header>{images.length ? <section className="generation-archive">{images.map((image) => <article key={image.id}>{image.url ? <img src={image.url} alt={`Generated concept for ${image.project.name}`} /> : null}<div><span>{image.project.name}</span><strong>Concept {String(image.position).padStart(2, "0")}</strong>{image.evaluation ? <small>{Math.round(image.evaluation.score)}/100</small> : null}</div></article>)}</section> : <section className="empty-studio"><h2>No generated images yet.</h2><p>Complete your first four-concept run to fill this archive.</p></section>}</main>
}
