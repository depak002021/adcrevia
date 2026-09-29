import { readCappedText, safeFetch, BRAND_USER_AGENT } from "./safe-fetch"

/**
 * robots.txt compliance.
 *
 * We identify ourselves honestly in the User-Agent, so we are obliged to honour
 * what the site asks of us. Beyond etiquette this is self-protective: ignoring
 * robots on a large site is how a crawler ends up in an infinite faceted-search
 * space, and how a client's domain ends up rate-limiting or blocking the VPS's
 * only outbound IP — which is shared with three other production stacks.
 *
 * Deliberately a small, permissive parser rather than a full implementation. It
 * understands the directives that actually appear in practice and fails OPEN on
 * anything it cannot read, because a malformed robots.txt should not make a
 * legitimate brand site unusable.
 */

export type RobotsRules = {
  /** Path prefixes we must not fetch. */
  disallow: string[]
  /** Path prefixes explicitly re-permitted inside a disallowed subtree. */
  allow: string[]
  /** Seconds the site asks us to wait between requests, if stated. */
  crawlDelaySeconds: number | null
  /** Sitemap URLs, which give a far better crawl seed than link-following. */
  sitemaps: string[]
}

const EMPTY_RULES: RobotsRules = {
  disallow: [],
  allow: [],
  crawlDelaySeconds: null,
  sitemaps: [],
}

const MAX_ROBOTS_BYTES = 128 * 1024

export async function fetchRobots(origin: string): Promise<RobotsRules> {
  try {
    const response = await safeFetch(new URL("/robots.txt", origin))
    // Anything other than a 200 means "no rules stated", which is permission.
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {})
      return EMPTY_RULES
    }
    return parseRobots(await readCappedText(response, MAX_ROBOTS_BYTES))
  } catch {
    // Unreachable or blocked robots.txt must not block the whole analysis.
    return EMPTY_RULES
  }
}

/**
 * Parse the groups that apply to us.
 *
 * Matching is against our own token and the `*` wildcard only. A group applies
 * when its User-Agent list contains either; consecutive User-Agent lines form one
 * group, which is why the "collecting agents" flag exists.
 */
export function parseRobots(body: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelaySeconds: null, sitemaps: [] }

  let applies = false
  let collectingAgents = false
  const selfToken = BRAND_USER_AGENT.split("/")[0].toLowerCase()

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim()
    if (!line) continue

    const separator = line.indexOf(":")
    if (separator === -1) continue

    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    // Sitemaps are global, not scoped to a group.
    if (field === "sitemap") {
      if (value) rules.sitemaps.push(value)
      continue
    }

    if (field === "user-agent") {
      // A User-Agent line following a directive starts a NEW group.
      if (!collectingAgents) applies = false
      collectingAgents = true
      const agent = value.toLowerCase()
      if (agent === "*" || agent.includes(selfToken)) applies = true
      continue
    }

    collectingAgents = false
    if (!applies) continue

    if (field === "disallow") {
      // An empty Disallow means "allow everything" and must not be treated as a
      // prefix match on "", which would block the entire site.
      if (value) rules.disallow.push(value)
    } else if (field === "allow") {
      if (value) rules.allow.push(value)
    } else if (field === "crawl-delay") {
      const seconds = Number(value)
      if (Number.isFinite(seconds) && seconds >= 0) {
        rules.crawlDelaySeconds = Math.min(seconds, 30)
      }
    }
  }

  return rules
}

/**
 * Whether a path may be fetched.
 *
 * Longest-match-wins between Allow and Disallow, which is the behaviour the major
 * crawlers implement and what site owners write their rules expecting.
 */
export function isAllowed(rules: RobotsRules, pathname: string): boolean {
  const longest = (patterns: string[]) =>
    patterns
      .filter((pattern) => matches(pattern, pathname))
      .reduce((best, pattern) => Math.max(best, pattern.length), -1)

  const disallowed = longest(rules.disallow)
  if (disallowed === -1) return true
  return longest(rules.allow) >= disallowed
}

/** Supports the two wildcards robots.txt actually uses: `*` and a trailing `$`. */
function matches(pattern: string, pathname: string): boolean {
  if (!pattern.includes("*") && !pattern.endsWith("$")) {
    return pathname.startsWith(pattern)
  }

  const anchored = pattern.endsWith("$")
  const body = anchored ? pattern.slice(0, -1) : pattern
  const expression = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")

  return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(pathname)
}
