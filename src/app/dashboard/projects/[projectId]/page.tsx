import { notFound } from "next/navigation"

import { ProjectWorkspace } from "@/components/generation/project-workspace"
import { Eyebrow } from "@/components/ui/eyebrow"
import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { projectSpend } from "@/features/costs/service"
import { readProjectSnapshot } from "@/features/projects/snapshot"

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const user = await requireUser()
  const { projectId } = await params

  // The same reader the event stream uses, so the first paint and the first
  // streamed frame describe the project identically. Two separate queries here
  // is what previously let the page and the stream disagree.
  const snapshot = await readProjectSnapshot(projectId, user.id)
  if (!snapshot) notFound()

  const [project, spend] = await Promise.all([
    getPrisma().project.findFirst({
      where: { id: projectId, userId: user.id },
      select: { name: true, prompt: { select: { original: true, enhanced: true } } },
    }),
    projectSpend(projectId, user.id),
  ])
  if (!project) notFound()

  return (
    <main className="mx-auto w-full max-w-[82rem] px-5 pt-8 pb-16 sm:px-8">
      <header className="mb-8">
        <Eyebrow>{snapshot.status.replaceAll("_", " ").toLowerCase()}</Eyebrow>
        <h1 className="mt-3 text-[2rem] leading-tight font-medium tracking-[-0.035em] text-fg sm:text-[2.4rem]">
          {project.name}
        </h1>
        <p className="mt-3 max-w-[52ch] text-[0.95rem] leading-relaxed text-muted">
          {project.prompt?.enhanced ?? project.prompt?.original}
        </p>
      </header>

      <ProjectWorkspace initial={snapshot} initialSpend={spend} />
    </main>
  )
}
