import type { CheerioAPI } from "cheerio"

import { absolute } from "./jsonld"

/**
 * Signals available on any page, structured data or not.
 *
 * OpenGraph is the reliable fallback: almost every CMS emits it, and `og:image`
 * is the publisher's own choice of hero shot, which is a better starting point for
 * a campaign reference than the largest `<img>` on the page.
 */

export type PageMeta = {
  title: string | null
  description: string | null
  siteName: string | null
  language: string | null
  ogImages: string[]
  logo: string | null
}

export function extractPageMeta($: CheerioAPI, baseUrl: string): PageMeta {
  const meta = (selector: string) => clean($(selector).attr("content"))

  return {
    // og:title is usually the curated headline; <title> often carries site
    // boilerplate ("Product — Brand — Free shipping").
    title: meta('meta[property="og:title"]') ?? clean($("title").first().text()),
    description:
      meta('meta[property="og:description"]') ?? meta('meta[name="description"]'),
    siteName: meta('meta[property="og:site_name"]'),
    language: clean($("html").attr("lang"))?.slice(0, 12) ?? null,
    ogImages: unique(
      [
        meta('meta[property="og:image"]'),
        meta('meta[property="og:image:secure_url"]'),
        meta('meta[name="twitter:image"]'),
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => absolute(value, baseUrl))
        .filter((value): value is string => Boolean(value)),
    ).slice(0, 4),
    logo: findLogo($, baseUrl),
  }
}

/**
 * Best-effort logo detection, in descending order of confidence.
 *
 * A declared `apple-touch-icon` is deliberately preferred over `favicon.ico`:
 * it is a real raster asset at a usable size, whereas favicons are frequently
 * 16px and useless as a brand reference.
 */
function findLogo($: CheerioAPI, baseUrl: string): string | null {
  const candidates = [
    $('link[rel="apple-touch-icon"]').attr("href"),
    $('link[rel="icon"][sizes]').attr("href"),
    // Sites commonly mark the wordmark with a class or alt containing "logo".
    $('img[class*="logo" i]').first().attr("src"),
    $('img[alt*="logo" i]').first().attr("src"),
    $('header img').first().attr("src"),
    $('link[rel="icon"]').attr("href"),
    $('link[rel="shortcut icon"]').attr("href"),
  ]

  for (const candidate of candidates) {
    const cleaned = clean(candidate)
    if (!cleaned) continue
    const resolved = absolute(cleaned, baseUrl)
    if (resolved) return resolved
  }
  return null
}

/**
 * Largest plausible content images, as a fallback when OpenGraph is absent.
 *
 * Filters on declared dimensions rather than fetching each image: the goal is a
 * usable reference, and downloading every asset on a page to measure it would be
 * disproportionate on a CPU-constrained host.
 */
export function extractContentImages($: CheerioAPI, baseUrl: string, limit = 6): string[] {
  const scored: { url: string; area: number }[] = []

  $("img").each((_, element) => {
    const node = $(element)
    const src = clean(node.attr("src")) ?? firstSrcFromSrcset(node.attr("srcset"))
    if (!src) return
    if (/\.svg($|\?)/i.test(src)) return // Usually iconography, not photography.

    const width = Number(node.attr("width")) || 0
    const height = Number(node.attr("height")) || 0
    // Undeclared dimensions are common; assume mid-size rather than discarding,
    // so a lazy-loaded hero is not ranked below a declared 40px icon.
    const area = width && height ? width * height : 240_000

    // Skip anything declared small enough to be a badge or tracking pixel.
    if (width && height && (width < 200 || height < 200)) return

    const resolved = absolute(src, baseUrl)
    if (resolved) scored.push({ url: resolved, area })
  })

  return unique(
    scored.sort((a, b) => b.area - a.area).map((entry) => entry.url),
  ).slice(0, limit)
}

/** `srcset` entries are "url width" pairs; the first URL is enough. */
function firstSrcFromSrcset(srcset: string | undefined): string | null {
  if (!srcset) return null
  const first = srcset.split(",")[0]?.trim().split(/\s+/)[0]
  return clean(first)
}

export function clean(value: string | undefined | null): string | null {
  if (!value) return null
  const trimmed = value.replace(/\s+/g, " ").trim()
  return trimmed ? trimmed.slice(0, 2000) : null
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

/**
 * Readable body text, for the model to infer tone and positioning.
 *
 * Script, style and navigation chrome are stripped first — without that the
 * output is mostly cookie banners and menu labels.
 */
export function extractReadableText($: CheerioAPI, maxLength = 3000): string {
  const clone = $.root().clone()
  clone.find("script, style, noscript, svg, nav, header, footer, form, iframe").remove()

  const text = clone.find("body").text() || clone.text()
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength)
}
