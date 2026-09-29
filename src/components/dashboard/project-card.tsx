import Link from "next/link"
import { ArrowUpRight, Clapperboard, ImageIcon } from "lucide-react"

export function ProjectCard({ project }: { project: { id: string; name: string; status: string; updatedAt: Date; images: Array<{ url: string | null }>; _count: { images: number; videos: number } } }) {
  return <article className="project-card"><Link href={`/dashboard/projects/${project.id}`} aria-label={`Open ${project.name}`}><div className="project-cover">{project.images[0]?.url ? <img src={project.images[0].url} alt="" /> : <div><span>AD</span><p>Creative brief</p></div>}<span className="project-status">{project.status.replaceAll("_", " ").toLowerCase()}</span></div><div className="project-info"><div><h2>{project.name}</h2><p>Updated {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(project.updatedAt)}</p></div><ArrowUpRight /></div><div className="project-stats"><span><ImageIcon size={14} />{project._count.images} images</span><span><Clapperboard size={14} />{project._count.videos} videos</span></div></Link></article>
}
