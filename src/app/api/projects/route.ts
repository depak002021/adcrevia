import { requireUser } from "@/lib/auth/guards"
import { createProjectDraft } from "@/features/projects/service"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"
import { scheduleWebsiteScrape } from "@/lib/jobs/schedule"

async function GETHandler(request: Request) {
  const user = await requireUser()
  const query = new URL(request.url).searchParams.get("q")?.trim()
  const projects = await getPrisma().project.findMany({
    where: { userId: user.id, ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}) },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, name: true, status: true, createdAt: true, updatedAt: true,
      images: { where: { status: "COMPLETED" }, orderBy: { position: "asc" }, take: 1, select: { url: true } },
      _count: { select: { images: true, videos: true } },
    },
  })
  return Response.json({ projects })
}

async function POSTHandler(request: Request) {
  const user = await requireUser()
  const body = await request.json().catch(() => null)
  try {
    const project = (await createProjectDraft(body, user.id)) as { id: string }

    // A brand URL on the brief is now analysed properly rather than probed and
    // forgotten: the full crawl is queued here so its result lands on the project
    // before the model is asked for creative directions.
    const reference = await getPrisma().websiteReference.findUnique({
      where: { projectId: project.id },
      select: { url: true },
    })
    if (reference?.url) {
      // Best-effort. The brief is already saved, so failing the request because a
      // background crawl could not be queued would be the wrong trade.
      await scheduleWebsiteScrape({ projectId: project.id, url: reference.url }).catch((error) => {
        console.error("[projects] could not queue website analysis", {
          projectId: project.id,
          message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        })
      })
    }

    return Response.json({ id: project.id }, { status: 201 })
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      return Response.json({ error: "Check your brief and try again." }, { status: 400 })
    }
    throw error
  }
}

export const GET = route(GETHandler)
export const POST = route(POSTHandler)
