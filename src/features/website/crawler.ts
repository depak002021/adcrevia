import * as cheerio from "cheerio"

import { assertPublicHttpUrl } from "./url-policy"
import { readCappedText, safeFetch } from "./safe-fetch"
import { fetchRobots, isAllowed, type RobotsRules } from "./robots"

/**
 * Bounded crawl of a brand site.
 *
 * Budgets are deliberately small. The goal is enough context to brief a campaign,
 * not a mirror of the site — and every page costs CPU on a host already at its
 * limit, plus goodwill with the client's own infrastructure.
 *
 * The page set is chosen by intent rather than by link order: a product or about
 * page is worth far more than a shipping-policy page, so candidates are scored
 * before being visited instead of crawling breadth-first and hoping.
 */

export type CrawledPage = {
  url: string
  status: number
  html: string
}

export type CrawlResult = {
  /** The URL actually landed on after redirects. */
  finalUrl: string
  pages: CrawledPage[]
  /** Reasons pages were skipped, for the admin log. Never shown to the user. */
  notes: string[]
}

export type CrawlBudget = {
  maxPages: number
  maxBytesPerPage: number
  /** Milliseconds between requests to the same host, on top of any Crawl-delay. */
  politenessMs: number
}

export const DEFAULT_BUDGET: CrawlBudget = {
  maxPages: 8,
  // Storefront product pages (Shopify themes, headless builds) are commonly 2–5 MB
  // of HTML; a 2 MB cap made a normal boAt product page "unavailable".
  maxBytesPerPage: 6 * 1024 * 1024,
  politenessMs: 250,
}

const MAX_REDIRECTS = 4

/** Paths worth spending a page budget on, highest first. */
const HIGH_VALUE = [
  /\/products?\//i,
  /\/shop\//i,
  /\/collections?\//i,
  /\/about/i,
  /\/story/i,
  /\/brand/i,
]

/** Paths that reliably contain nothing useful for a creative brief. */
const LOW_VALUE =
  /\/(cart|checkout|account|login|register|signin|signup|search|wishlist|compare|privacy|terms|cookie|returns?|shipping|faq|support|help|blog\/page|tag|author|feed|rss|sitemap)/i

export async function crawlSite(
  rawUrl: string,
  budget: CrawlBudget = DEFAULT_BUDGET,
): Promise<CrawlResult> {
  const seed = await assertPublicHttpUrl(rawUrl)
  const robots = await fetchRobots(seed.origin)

  const notes: string[] = []
  if (robots.sitemaps.length) notes.push(`robots declared ${robots.sitemaps.length} sitemap(s)`)

  // The landing page is always fetched first: it establishes the final URL after
  // redirects and carries the site-wide Organization graph.
  const landing = await fetchPage(seed.toString(), budget.maxBytesPerPage)
  if (!landing) return { finalUrl: seed.toString(), pages: [], notes: [...notes, "landing page unreadable"] }

  const pages: CrawledPage[] = [landing]
  const visited = new Set([normalizeForDedupe(landing.url)])
  const finalUrl = landing.url
  const origin = new URL(finalUrl).origin

  const delayMs = Math.max(
    budget.politenessMs,
    (robots.crawlDelaySeconds ?? 0) * 1000,
  )

  const candidates = rankCandidates(landing, origin, robots, visited)

  for (const candidate of candidates) {
    if (pages.length >= budget.maxPages) break

    const key = normalizeForDedupe(candidate)
    if (visited.has(key)) continue
    visited.add(key)

    await sleep(delayMs)

    const page = await fetchPage(candidate, budget.maxBytesPerPage)
    if (page) pages.push(page)
    else notes.push(`skipped ${candidate}`)
  }

  return { finalUrl, pages, notes }
}

/**
 * Score and order the links worth following.
 *
 * Same-origin only. Following off-origin links would mean re-running the address
 * checks against arbitrary third parties and would drift away from the brand
 * being analysed.
 */
function rankCandidates(
  landing: CrawledPage,
  origin: string,
  robots: RobotsRules,
  visited: Set<string>,
): string[] {
  const $ = cheerio.load(landing.html)
  const scored = new Map<string, number>()

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href")
    if (!href || href.startsWith("#")) return

    let url: URL
    try {
      url = new URL(href, landing.url)
    } catch {
      return
    }

    if (url.origin !== origin) return
    if (!["http:", "https:"].includes(url.protocol)) return

    // Fragments and tracking parameters produce duplicate pages.
    url.hash = ""
    for (const parameter of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|mc_)/i.test(parameter)) url.searchParams.delete(parameter)
    }

    const candidate = url.toString()
    if (visited.has(normalizeForDedupe(candidate))) return
    if (LOW_VALUE.test(url.pathname)) return
    if (!isAllowed(robots, url.pathname)) return

    const highValueIndex = HIGH_VALUE.findIndex((pattern) => pattern.test(url.pathname))
    // Shallower paths are usually more canonical, so depth is a tiebreaker.
    const depth = url.pathname.split("/").filter(Boolean).length
    const score = (highValueIndex === -1 ? 100 : highValueIndex) + depth

    const existing = scored.get(candidate)
    if (existing === undefined || score < existing) scored.set(candidate, score)
  })

  return [...scored.entries()].sort((a, b) => a[1] - b[1]).map(([url]) => url)
}

/**
 * Fetch one page, following redirects manually so every hop is re-validated.
 *
 * Returns null rather than throwing: one unreachable page should never abort a
 * crawl that has already gathered useful context.
 */
async function fetchPage(rawUrl: string, maxBytes: number): Promise<CrawledPage | null> {
  let current = rawUrl

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let response: Awaited<ReturnType<typeof safeFetch>>
    try {
      await assertPublicHttpUrl(current)
      response = await safeFetch(current, {
        headers: { accept: "text/html,application/xhtml+xml" },
      })
    } catch {
      return null
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      await response.body?.cancel().catch(() => {})
      if (!location) return null
      try {
        current = new URL(location, current).toString()
      } catch {
        return null
      }
      continue
    }

    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {})
      return null
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      await response.body?.cancel().catch(() => {})
      return null
    }

    try {
      const html = await readCappedText(response, maxBytes)
      return { url: current, status: response.status, html }
    } catch {
      return null
    }
  }

  return null
}

/** Trailing slashes and casing produce duplicate visits otherwise. */
function normalizeForDedupe(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    const path = parsed.pathname.replace(/\/+$/, "") || "/"
    return `${parsed.origin.toLowerCase()}${path}${parsed.search}`
  } catch {
    return url
  }
}

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
