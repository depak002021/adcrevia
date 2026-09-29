import { readConversationForProject } from "@/features/brief/conversation"
import { settleProgress } from "@/features/brief/service"
import { analyzeWebsite } from "@/features/website/analyzer"
import { persistWebsiteAnalysis, persistWebsiteFailure } from "@/features/website/persist"
import { storeReferenceImages, type StoredReference } from "@/features/website/references"
import { createStorageProvider } from "@/lib/storage/runtime"
import { scheduleAgentStep } from "../schedule"
import { registerHandler } from "../registry"
import { PermanentJobError } from "../types"

/**
 * Brand site analysis as durable work.
 *
 * A crawl reads up to eight pages with politeness delays between them, so it can
 * run for tens of seconds — too long to hold a request open, and exactly the kind
 * of work that should survive the user navigating away.
 *
 * Failures are persisted rather than swallowed, so the brief can explain itself on
 * a later visit instead of showing an empty field with no reason.
 */

/** Failures that a retry cannot fix. */
const PERMANENT_CODES = new Set([
  // The URL is not something we are allowed to fetch at all.
  "PUBLIC_HTTP_URL_REQUIRED",
  "BLOCKED_PRIVATE_ADDRESS",
  // The site refuses automated reading; retrying only asks again.
  "WEBSITE_BLOCKED",
])

registerHandler("WEBSITE_SCRAPE", async (payload, { report, heartbeat }) => {
  await report(10, "Reading the site")

  try {
    // The crawl paces itself between pages, so the lease is renewed before it
    // starts rather than risking expiry mid-crawl.
    await heartbeat()

    const analysis = await analyzeWebsite(payload.url)

    await report(70, "Saving product photos")
    const references = await copyReferences(payload.projectId, analysis.referenceImages)

    await report(85, "Saving brand context")
    await persistWebsiteAnalysis(payload.projectId, analysis, references)

    // What was just learned changes how complete the brief is, so the meter moves
    // now rather than waiting for the user to type again. Best-effort: the crawl
    // succeeded, and failing the job over a follow-up would discard that.
    await resumeConversation(payload.projectId)

    await report(
      100,
      analysis.products.length
        ? `Found ${analysis.products.length} product${analysis.products.length === 1 ? "" : "s"}`
        : "Brand context saved",
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : "WEBSITE_UNAVAILABLE"
    const safeErrorCode = KNOWN_CODES.has(code) ? code : "WEBSITE_UNAVAILABLE"

    // Best-effort: if recording the failure also fails, the job failure below is
    // still the authoritative signal.
    await persistWebsiteFailure(payload.projectId, payload.url, safeErrorCode).catch(() => {})
    // The first reply may be waiting on this crawl: let it go ahead without the page.
    await resumeConversation(payload.projectId)

    if (PERMANENT_CODES.has(safeErrorCode)) throw new PermanentJobError(safeErrorCode)
    throw error
  }
})

/**
 * Hand control back to the brief.
 *
 * Only when a conversation exists: a project created through the older form has no
 * transcript to continue, and queueing an agent step for it would start a
 * conversation nobody asked for.
 *
 * The scrape is what makes the agent's `read_website` call worth making — it returns
 * as soon as the crawl is queued, so this is how the results reach it.
 */
async function resumeConversation(projectId: string) {
  try {
    const conversation = await readConversationForProject(projectId)
    if (!conversation) return
    await settleProgress({ conversationId: conversation.id, projectId })
    await scheduleAgentStep({ conversationId: conversation.id, projectId })
  } catch (error) {
    console.error("[website] could not resume the brief", {
      projectId,
      reason: error instanceof Error ? error.name : "unknown",
    })
  }
}

/**
 * Copy the product's photos to our bucket. Never fails the job: without references
 * generation still works from the written brief, just with less product fidelity.
 */
async function copyReferences(projectId: string, urls: string[]): Promise<StoredReference[]> {
  if (urls.length === 0) return []
  try {
    return await storeReferenceImages(projectId, urls, await createStorageProvider())
  } catch (error) {
    console.error("[website] could not store product references", {
      projectId,
      reason: error instanceof Error ? error.message : "unknown",
    })
    return []
  }
}

/** Codes the analyser is known to raise; anything else is normalised. */
const KNOWN_CODES = new Set([
  "PUBLIC_HTTP_URL_REQUIRED",
  "BLOCKED_PRIVATE_ADDRESS",
  "WEBSITE_UNAVAILABLE",
  "WEBSITE_TOO_LARGE",
  "WEBSITE_HTML_REQUIRED",
  "WEBSITE_REDIRECT_LIMIT",
  "WEBSITE_BLOCKED",
])
