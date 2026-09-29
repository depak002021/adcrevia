import type { CheerioAPI } from "cheerio"

import type { ProductFacts } from "./jsonld"
import { clean, unique, type PageMeta } from "./page"

/**
 * The product on a product page that publishes no structured data.
 *
 * Many stores (custom builds, wholesale catalogues, regional marketplaces) ship a
 * perfectly good product page with no schema.org Product and no embedded JSON: the
 * facts are in the headline, the share tags and the photo gallery. Without this, such
 * a link fell through to whatever product the crawler found elsewhere on the site, and
 * a casserole link came back as the site's featured T-shirt with no photos.
 *
 * Deterministic, no model call. Photos are kept only when they are demonstrably this
 * product's: they carry the product's own codes (size, SKU, model number) that the
 * link and the share image both carry, or most of its name. That excludes sibling
 * sizes, related products and site banners.
 */

const MAX_IMAGES = 8

const BUY_SIGNAL = /add to (cart|bag|basket)|buy now|add to quote|get (a )?quote|request (a )?quote|in stock|out of stock|₹\s?\d|\brs\.?\s?\d|\$\s?\d|€\s?\d|£\s?\d|\bprice\b|\bmrp\b|\bmoq\b/i
const NOT_PRODUCT_PATH = /\/(blog|blogs|news|article|articles|stories|journal|help|faq|about|contact|careers?|pages?)(\/|$)|\/\d{4}\/\d{2}\//i
const IMAGE_URL = /https?:\\?\/\\?\/[^\s"'<>()]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>()]*)?/gi

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2)
}

/** Digit runs of 3+ characters: sizes, SKUs, model numbers — what tells siblings apart. */
function codes(value: string): string[] {
  return [...new Set(value.match(/\d{3,}/g) ?? [])]
}

function lastSegment(url: string): string {
  try {
    const segments = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean)
    return segments[segments.length - 1] ?? ""
  } catch {
    return ""
  }
}

function withoutSiteSuffix(title: string | null): string | null {
  const first = (title ?? "").split(/\s[|–—-]\s/)[0]?.trim()
  return first ? first : null
}

function imageKey(url: string): string {
  return url.split("?")[0].toLowerCase()
}

export function looksLikeProductPage($: CheerioAPI, url: string, text: string): boolean {
  const ogType = clean($('meta[property="og:type"]').attr("content"))?.toLowerCase() ?? ""
  if (ogType.includes("product")) return true
  if ($('meta[property="product:price:amount"], meta[property="og:price:amount"], [itemprop="price"]').length) return true
  if (ogType === "article") return false
  let path = ""
  try {
    path = new URL(url).pathname
  } catch {
    return false
  }
  if (NOT_PRODUCT_PATH.test(path)) return false
  // A descriptive slug ("red-kitchen-chef-...-2000ml") plus something to buy.
  return words(lastSegment(url)).length >= 3 && BUY_SIGNAL.test(text.slice(0, 40_000))
}

export function extractPageProduct($: CheerioAPI, html: string, url: string, meta: PageMeta, text: string): ProductFacts | null {
  if (!looksLikeProductPage($, url, text)) return null

  const slug = lastSegment(url)
  const titleName = withoutSiteSuffix(meta.title) ?? withoutSiteSuffix(clean($('[itemprop="name"]').attr("content")))
  const h1 = clean($("h1").first().text())
  // The headline is usually the cleanest name; use it when it is about this page.
  const reference = new Set([...words(slug), ...words(titleName ?? "")])
  const h1Matches = h1 ? words(h1).filter((word) => reference.has(word)).length >= Math.min(2, words(h1).length) : false
  const name = (h1Matches ? h1 : titleName) ?? h1
  if (!name) return null

  const amount = Number(clean($('meta[property="product:price:amount"], meta[property="og:price:amount"]').attr("content")) ?? $('[itemprop="price"]').attr("content"))
  const currency = clean($('meta[property="product:price:currency"], meta[property="og:price:currency"]').attr("content")) ?? clean($('[itemprop="priceCurrency"]').attr("content"))

  return {
    name,
    brand: null,
    description: meta.description,
    category: null,
    sku: null,
    price: Number.isFinite(amount) && amount > 0 && currency ? { amount, currency } : null,
    availability: null,
    images: productImages(html, url, meta.ogImages, name),
  }
}

/** This product's photos: share image first, then gallery photos that carry its codes or name. */
export function productImages(html: string, url: string, ogImages: string[], name: string): string[] {
  const found = unique((html.match(IMAGE_URL) ?? []).map((value) => value.replace(/\\\//g, "/")))
  const slug = lastSegment(url)
  const share = ogImages[0] ? lastSegment(ogImages[0]) : ""
  // Codes the link and the share image agree on identify this exact variant.
  const anchors = codes(slug).filter((code) => codes(share).includes(code))
  const nameWords = [...new Set([...words(name), ...words(slug)])].filter((word) => !/^\d+$/.test(word))

  const belongs = (image: string) => {
    const file = lastSegment(image).toLowerCase()
    if (/logo|icon|sprite|favicon|placeholder|banner/.test(file)) return false
    if (anchors.length) return anchors.every((code) => file.includes(code))
    if (nameWords.length < 2) return false
    const fileWords = new Set(words(file))
    return nameWords.filter((word) => fileWords.has(word)).length / nameWords.length >= 0.6
  }

  const seen = new Set<string>()
  const result: string[] = []
  for (const image of [...ogImages, ...found.filter(belongs)]) {
    const key = imageKey(image)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(image)
    if (result.length >= MAX_IMAGES) break
  }
  return result
}
