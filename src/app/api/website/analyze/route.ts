import { z } from "zod"

import { requireUser } from "@/lib/auth/guards"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"
import { scheduleWebsiteScrape } from "@/lib/jobs/schedule"
import { analyzeWebsite } from "@/features/website/analyzer"
import { rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"

/**
 * Analyse a brand website.
 *
 * Two modes, because the two callers want different things:
 *
 *   - With a `projectId`, the crawl is queued. It reads several pages with
 *     politeness delays, which is too slow to hold a request open, and the result
 *     has somewhere to be stored.
 *   - Without one, a single-page read runs inline. This is the brief form probing
 *     a URL the user just typed, before any project exists — there is nothing to
 *     attach a job to, and the user is watching.
 *
 * Either way the result is now PERSISTED when a project exists. Previously it was
 * returned to the browser and dropped, so the model never saw it.
 */

const schema = z.object({
  url: z.string().url().max(2048),
  /** Present once the brief has been saved. */
  projectId: z.string().cuid().optional(),
})

/** Inline probe reads one page only; the full crawl belongs to the worker. */
const PROBE_BUDGET = { maxPages: 1, maxBytesPerPage: 2 * 1024 * 1024, politenessMs: 0 }

async function POSTHandler(request: Request) {
  const user = await requireUser()

  const limit = await rateLimiter.check({
    action: "website-analysis",
    identifier: user.id,
    limit: 10,
    windowSeconds: 60 * 60,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Enter a valid public website URL." }, { status: 400 })
  }

  if (parsed.data.projectId) {
    const project = await getPrisma().project.findFirst({
      where: { id: parsed.data.projectId, userId: user.id },
      select: { id: true },
    })
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 })

    const job = await scheduleWebsiteScrape({ projectId: project.id, url: parsed.data.url })
    return Response.json({ job: { id: job.id, status: job.status } }, { status: 202 })
  }

  try {
    const analysis = await analyzeWebsite(parsed.data.url, PROBE_BUDGET)
    // Only the fields the form needs. The full analysis contains crawl telemetry
    // and body text that the browser has no use for.
    return Response.json({
      title: analysis.title,
      siteName: analysis.siteName,
      description: analysis.description,
      colors: analysis.colors.map((color) => color.hex),
      typography: analysis.typography,
      logo: analysis.logo,
      productCount: analysis.products.length,
      summary: analysis.summary,
    })
  } catch (error) {
    // A blocked address is a bad request, not a failure to read a real site, and
    // saying so plainly is better than implying the site is broken.
    if (error instanceof Error && error.message === "PUBLIC_HTTP_URL_REQUIRED") {
      return Response.json(
        { error: "That address is not a public website.", code: "PUBLIC_HTTP_URL_REQUIRED" },
        { status: 400 },
      )
    }
    return Response.json(
      { error: "We couldn’t read that site. You can continue without it." },
      { status: 422 },
    )
  }
}

export const POST = route(POSTHandler)
