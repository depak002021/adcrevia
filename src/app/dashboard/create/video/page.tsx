import Link from "next/link"

import { VideoGenerator } from "@/components/videos/video-generator"
import { supportedAspectRatiosFor } from "@/features/videos/schemas"
import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { resolveActiveVideoProviderName } from "@/lib/providers/configuration"
import { asImageFormat, VIDEO_ASPECT_FOR_FORMAT } from "@/lib/providers/images/formats"

export default async function CreateVideoPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireUser()
  const { project: projectId } = await searchParams
  const project = projectId ? await getPrisma().project.findFirst({ where: { id: projectId, userId: user.id }, include: { imageSelections: { orderBy: { position: "asc" }, include: { image: true } }, prompt: { select: { original: true } } } }) : null
  // Authoritative ordered sources: only completed frames, re-numbered 1..n so a
  // gap in stored positions never leaks into scene labels. No credentials or
  // polling metadata are ever handed to the client.
  const sources = (project?.imageSelections ?? [])
    .filter((selection) => selection.image?.status === "COMPLETED" && selection.image.url)
    .map((selection, index) => ({ id: selection.image.id, url: selection.image.url as string, position: index + 1 }))
  const provider = project && sources.length > 0 ? await resolveActiveVideoProviderName() : null
  // The frames' shape decides the reel's: vertical frames make a vertical video.
  const preferredAspectRatio = project?.imageFormat ? VIDEO_ASPECT_FOR_FORMAT[asImageFormat(project.imageFormat)] : undefined
  return <main className="studio-page create-video-page"><header className="studio-header"><div><p className="eyebrow">New creation · Step 4 of 4</p><h1>Bring the scenes to life.</h1><p>Direct the movement while preserving the product, art direction, and ordered scenes you selected.</p></div></header>{project && provider && sources.length > 0 ? <VideoGenerator projectId={project.id} sources={sources} provider={provider} supportedAspectRatios={supportedAspectRatiosFor(provider)} preferredAspectRatio={preferredAspectRatio} defaultPrompt={project.prompt?.original.slice(0, 2000) ?? ""} /> : <section className="empty-studio"><h2>Select a completed image first.</h2><p>A video can only begin from campaign frames you explicitly choose.</p><Link className="secondary-button" href={projectId ? `/dashboard/projects/${projectId}` : "/dashboard/projects"}>Return to projects</Link></section>}</main>
}
