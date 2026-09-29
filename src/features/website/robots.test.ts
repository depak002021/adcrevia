import { describe, expect, it } from "vitest"

import { isAllowed, parseRobots } from "./robots"

describe("parseRobots", () => {
  it("applies the wildcard group", () => {
    const rules = parseRobots(`
      User-agent: *
      Disallow: /cart
      Disallow: /checkout
      Crawl-delay: 2
      Sitemap: https://brand.example/sitemap.xml
    `)

    expect(rules.disallow).toEqual(["/cart", "/checkout"])
    expect(rules.crawlDelaySeconds).toBe(2)
    expect(rules.sitemaps).toEqual(["https://brand.example/sitemap.xml"])
  })

  it("applies a group naming our own agent", () => {
    const rules = parseRobots(`
      User-agent: Googlebot
      Disallow: /google-only

      User-agent: AdcreviaBrandAnalyzer
      Disallow: /private
    `)

    // Only our group's rule applies; Googlebot's is irrelevant to us.
    expect(rules.disallow).toEqual(["/private"])
  })

  it("treats consecutive User-agent lines as one group", () => {
    const rules = parseRobots(`
      User-agent: Bingbot
      User-agent: *
      Disallow: /shared
    `)

    // The `*` in the same group means the rule applies to us.
    expect(rules.disallow).toEqual(["/shared"])
  })

  it("starts a new group when a User-agent follows a directive", () => {
    const rules = parseRobots(`
      User-agent: *
      Disallow: /everyone

      User-agent: SomeOtherBot
      Disallow: /not-ours
    `)

    expect(rules.disallow).toEqual(["/everyone"])
  })

  it("ignores an empty Disallow rather than blocking the whole site", () => {
    // `Disallow:` with no value means "allow everything". Treating it as a prefix
    // match on "" would block every path.
    const rules = parseRobots(`
      User-agent: *
      Disallow:
    `)

    expect(rules.disallow).toEqual([])
    expect(isAllowed(rules, "/anything")).toBe(true)
  })

  it("strips comments and tolerates junk lines", () => {
    const rules = parseRobots(`
      # a comment
      User-agent: *   # trailing comment
      Disallow: /admin
      this line has no colon
    `)

    expect(rules.disallow).toEqual(["/admin"])
  })

  it("caps an absurd crawl delay", () => {
    // A site asking for an hour between requests would stall a worker slot; the
    // cap keeps us polite without being held hostage.
    expect(parseRobots("User-agent: *\nCrawl-delay: 3600").crawlDelaySeconds).toBe(30)
  })
})

describe("isAllowed", () => {
  const rules = parseRobots(`
    User-agent: *
    Disallow: /products/
    Allow: /products/featured
  `)

  it("permits anything not disallowed", () => {
    expect(isAllowed(rules, "/about")).toBe(true)
  })

  it("blocks a disallowed prefix", () => {
    expect(isAllowed(rules, "/products/hidden-item")).toBe(false)
  })

  it("lets a longer Allow win over a shorter Disallow", () => {
    // Longest-match-wins is what the major crawlers implement, and what site
    // owners write these rules expecting.
    expect(isAllowed(rules, "/products/featured/aurora")).toBe(true)
  })

  it("honours a wildcard in the middle of a pattern", () => {
    const wildcard = parseRobots("User-agent: *\nDisallow: /*?sort=")
    expect(isAllowed(wildcard, "/collections/all?sort=price")).toBe(false)
    expect(isAllowed(wildcard, "/collections/all")).toBe(true)
  })

  it("honours an anchored pattern", () => {
    const anchored = parseRobots("User-agent: *\nDisallow: /*.pdf$")
    expect(isAllowed(anchored, "/media/catalogue.pdf")).toBe(false)
    // The anchor means only a trailing match counts.
    expect(isAllowed(anchored, "/media/catalogue.pdf.html")).toBe(true)
  })
})
