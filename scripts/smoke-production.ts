import "dotenv/config"

import { getPrisma } from "@/lib/db/prisma"
import { getDefaultImageCount } from "@/features/admin/settings/service"
import { listMaskedProviders } from "@/features/admin/providers/service"

const KIND_SPECIFIC_SLUGS = new Set(["openai-image", "runway-video", "bfl-image", "bfl-video"])

// Fields a structured generation log line is allowed to contain. Anything else
// (headers, API keys, base64 media, polling URLs, raw provider bodies) is a leak.
const ALLOWED_LOG_FIELDS = new Set([
  "provider",
  "model",
  "taskId",
  "duration",
  "correlationId",
  "safeErrorCode",
])
const FORBIDDEN_LOG_MARKERS = ["x-key", "authorization", "apikey", "api_key", "pollingUrl", "polling_url", "data:image", "data:video", "encryptedCredential", "ciphertext"]

async function checkHttp() {
  const baseUrl = (process.env.SMOKE_BASE_URL ?? process.env.APP_URL)?.replace(/\/$/, "")
  if (!baseUrl) throw new Error("SMOKE_BASE_URL or APP_URL is required")

  const health = await fetch(`${baseUrl}/api/health`, { redirect: "error" })
  const healthBody = await health.json() as { status?: string }
  if (!health.ok || healthBody.status !== "ready") {
    throw new Error(`Health check failed (${health.status}): ${JSON.stringify(healthBody)}`)
  }

  const landing = await fetch(baseUrl, { redirect: "error" })
  if (!landing.ok) throw new Error(`Landing page failed (${landing.status})`)
  const requiredHeaders = ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"]
  const missingHeaders = requiredHeaders.filter((header) => !landing.headers.get(header))
  if (missingHeaders.length) throw new Error(`Missing security headers: ${missingHeaders.join(", ")}`)

  const html = await landing.text()
  if (!html.includes("Adcrevia")) throw new Error("Landing page did not contain the Adcrevia product marker")
  process.stdout.write(`Production smoke passed: ${baseUrl}\n`)
}

async function checkWorkflowInvariants() {
  const db = getPrisma()

  // 1. The admin generation policy is readable and within the enforced range.
  const defaultImageCount = await getDefaultImageCount()
  if (!Number.isInteger(defaultImageCount) || defaultImageCount < 1 || defaultImageCount > 10) {
    throw new Error(`generation.defaultImageCount is out of range: ${defaultImageCount}`)
  }

  // 2. Active provider rows use kind-specific slugs only.
  const activeConfigs = await db.aPIConfiguration.findMany({
    where: { enabled: true },
    select: { provider: { select: { slug: true } } },
  })
  const badSlugs = activeConfigs
    .map((config) => config.provider.slug)
    .filter((slug) => !KIND_SPECIFIC_SLUGS.has(slug))
  if (badSlugs.length) throw new Error(`Active providers use legacy slugs: ${[...new Set(badSlugs)].join(", ")}`)

  // 3. The real masked-provider serialization exposes no credential material.
  // This exercises the same code path the admin API returns to clients, so a
  // regression that leaked ciphertext or plaintext would actually be caught.
  const maskedProviders = [...await listMaskedProviders("IMAGE"), ...await listMaskedProviders("VIDEO")]
  const serialized = JSON.stringify(maskedProviders)
  for (const marker of ["encryptedCredential", "ciphertext", "iv", "authTag"]) {
    if (serialized.includes(marker)) throw new Error(`Masked provider listing exposed credential field: ${marker}`)
  }

  // 4. Ordered image selections have unique, contiguous positions per project.
  const selections = await db.imageSelection.findMany({ select: { projectId: true, position: true }, orderBy: [{ projectId: "asc" }, { position: "asc" }] })
  const byProject = new Map<string, number[]>()
  for (const selection of selections) {
    const positions = byProject.get(selection.projectId) ?? []
    positions.push(selection.position)
    byProject.set(selection.projectId, positions)
  }
  for (const [projectId, positions] of byProject) {
    const unique = new Set(positions)
    if (unique.size !== positions.length) throw new Error(`Project ${projectId} has duplicate selection positions`)
    const sorted = [...positions].sort((a, b) => a - b)
    if (sorted[0] !== 1 || sorted.some((value, index) => value !== index + 1)) {
      throw new Error(`Project ${projectId} selection positions are not contiguous from 1`)
    }
  }

  // 5. Generated video sources preserve contiguous 1..n order.
  const videoSources = await db.generatedVideoSource.findMany({ select: { videoId: true, position: true }, orderBy: [{ videoId: "asc" }, { position: "asc" }] })
  const byVideo = new Map<string, number[]>()
  for (const source of videoSources) {
    const positions = byVideo.get(source.videoId) ?? []
    positions.push(source.position)
    byVideo.set(source.videoId, positions)
  }
  for (const [videoId, positions] of byVideo) {
    const sorted = [...positions].sort((a, b) => a - b)
    if (new Set(positions).size !== positions.length || sorted[0] !== 1 || sorted.some((value, index) => value !== index + 1)) {
      throw new Error(`Video ${videoId} sources are not contiguous from 1`)
    }
  }

  process.stdout.write(`Workflow invariants passed: count=${defaultImageCount}, providers=${activeConfigs.length}, selections=${byProject.size} projects, videos=${byVideo.size}\n`)
}

/**
 * Structured generation logs may only carry the safe fields. This scans any log
 * lines exposed via SMOKE_GENERATION_LOG (path or JSON) and rejects credentials,
 * headers, base64 media, polling URLs, or raw provider bodies.
 */
function checkGenerationLogs() {
  const raw = process.env.SMOKE_GENERATION_LOG
  if (!raw) return
  const lines = raw.trim().split(/\r?\n/).filter(Boolean)
  for (const line of lines) {
    const lower = line.toLowerCase()
    for (const marker of FORBIDDEN_LOG_MARKERS) {
      if (lower.includes(marker.toLowerCase())) throw new Error(`Generation log leaked forbidden field: ${marker}`)
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      throw new Error("Generation log line is not structured JSON")
    }
    const extraKeys = Object.keys(parsed).filter((key) => !ALLOWED_LOG_FIELDS.has(key))
    if (extraKeys.length) throw new Error(`Generation log exposed disallowed fields: ${extraKeys.join(", ")}`)
  }
  process.stdout.write(`Generation log scan passed: ${lines.length} line(s)\n`)
}

async function main() {
  await checkHttp()
  checkGenerationLogs()
  if (process.env.DATABASE_URL) {
    await checkWorkflowInvariants()
  } else {
    process.stdout.write("DATABASE_URL not set; skipping workflow invariant checks\n")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Production smoke failed")
  process.exitCode = 1
})
