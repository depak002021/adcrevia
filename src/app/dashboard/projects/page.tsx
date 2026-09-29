import Link from "next/link"
import { Plus, Search } from "lucide-react"

import { ProjectCard } from "@/components/dashboard/project-card"
import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser()
  const { q = "" } = await searchParams
  const projects = await getPrisma().project.findMany({
    where: { userId: user.id, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, status: true, updatedAt: true, images: { where: { status: "COMPLETED" }, orderBy: { position: "asc" }, take: 1, select: { url: true } }, _count: { select: { images: true, videos: true } } },
  })
  return <main className="studio-page"><header className="studio-header"><div><p className="eyebrow">Persistent creative work</p><h1>Projects</h1><p>Return to any campaign, recover generation progress, or move a selected frame into motion.</p></div><Link className="primary-button" href="/dashboard/create"><Plus size={17} /> New project</Link></header><form className="project-search"><Search size={18} /><input name="q" defaultValue={q} placeholder="Search projects" aria-label="Search projects" /><button type="submit">Search</button></form>{projects.length ? <section className="project-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} />)}</section> : <section className="empty-studio"><h2>{q ? "No matching projects." : "No projects yet."}</h2><p>{q ? "Try a different search term." : "Your first campaign brief will appear here."}</p><Link className="secondary-button" href="/dashboard/create">Create a project</Link></section>}</main>
}
