import * as cheerio from "cheerio"

import { crawlSite, DEFAULT_BUDGET, type CrawlBudget } from "./crawler"
import { extractJsonLd, type BrandFacts, type ProductFacts } from "./extract/jsonld"
import { extractContentImages, extractPageMeta, extractReadableText, unique } from "./extract/page"
import { extractColors, extractTypography, type ColorWeight } from "./extract/style"
import { looksLikeBotWall } from "./bot-wall"
import { extractEmbeddedProducts } from "./extract/embedded"
import { extractPageProduct } from "./extract/page-product"
import { fetchShopifyProduct } from "./shopify"
import { identifyPrimaryProduct, selectReferenceImages, withPrimaryFirst } from "./primary-product"

/**
 * Brand analysis for a creative brief.
 *
 * Replaces a single-page regex pass that read `<title>`, the first eight hex
 * literals and a meta description — and whose result was then discarded without
 * ever being persisted, so the model never saw any of it.
 *
 * What this produces instead is the set of facts a person would gather before
 * writing a brief: what the product is, what it costs, what the brand calls
 * itself, which colours and typefaces it actually uses, and what its own hero
 * imagery looks like.
 */

export type WebsiteAnalysis = {
  /** The URL that was requested. */
  url: string
  /** Where it landed after redirects; these differ more often than expected. */
  finalUrl: string
  title: string | null
  description: string | null
  siteName: string | null
  language: string | null
  /** Ordered by how often each colour appears in style declarations. */
  colors: ColorWeight[]
  typography: string[]
  /** Publisher-chosen imagery first, largest content images as a fallback. */
  heroImages: string[]
  logo: string | null
  /** The linked product first when the page is a product page (see primary-product.ts). */
  products: ProductFacts[]
  /** True when `products[0]` is the product this page is about. */
  hasPrimaryProduct: boolean
  /** Photos of that product, for generation references. Empty on non-product pages. */
  referenceImages: string[]
  brand: BrandFacts | null
  /** Trimmed body copy, for tone and positioning. */
  excerpt: string
  pagesVisited: string[]
  /** Operator-facing crawl notes. Never surfaced to the user. */
  notes: string[]
  summary: string
  extractedAt: string
}

export async function analyzeWebsite(
  rawUrl: string,
  budget: CrawlBudget = DEFAULT_BUDGET,
): Promise<WebsiteAnalysis> {
  const crawl = await crawlSite(rawUrl, budget)
  if (crawl.pages.length === 0) throw new Error("WEBSITE_UNAVAILABLE")

  const [landing, ...rest] = crawl.pages
  const landing$ = cheerio.load(landing.html)

  const landingJsonLd = extractJsonLd(landing$, landing.url)
  // Storefront apps (Next.js and similar) ship the product as JSON in the HTML.
  const embedded = extractEmbeddedProducts(landing$, landing.url)

  // A bot wall parses fine and would become an empty brief; say what happened instead.
  if (looksLikeBotWall({ html: landing.html, text: extractReadableText(landing$), productCount: landingJsonLd.products.length + embedded.length })) {
    throw new Error("WEBSITE_BLOCKED")
  }

  const meta = extractPageMeta(landing$, landing.url)
  // A Shopify product link: the store's own feed has the product and every photo.
  const shopify = await fetchShopifyProduct(crawl.finalUrl)

  // Colour and type come from the landing page only. Deeper pages share the same
  // stylesheet, so aggregating them would just multiply the same counts and
  // distort the weighting.
  const colors = extractColors(landing$)
  const typography = extractTypography(landing$)

  const collected: ProductFacts[] = []
  for (const product of [...(shopify ? [shopify] : []), ...landingJsonLd.products, ...embedded]) {
    if (!collected.some((existing) => existing.name && existing.name === product.name)) collected.push(product)
  }
  // A product page without structured data: read the product from the page itself,
  // before other pages' products can be mistaken for it.
  const pageProduct =
    collected.length === 0 ? extractPageProduct(landing$, landing.html, crawl.finalUrl, meta, extractReadableText(landing$, 40_000)) : null
  if (pageProduct) collected.push(pageProduct)
  const landingCount = collected.length
  let brand: BrandFacts | null = landingJsonLd.brand
  const otherPageImages: string[] = []

  for (const page of rest) {
    const $ = cheerio.load(page.html)
    const jsonLd = extractJsonLd($, page.url)

    for (const product of jsonLd.products) {
      // Product pages are frequently reachable by several URLs; de-duplicate on
      // name so the same item is not described three times to the model.
      const duplicate = collected.some(
        (existing) => existing.name && existing.name === product.name,
      )
      if (!duplicate) collected.push(product)
    }

    brand ??= jsonLd.brand
    otherPageImages.push(...extractPageMeta($, page.url).ogImages)
  }

  // The product the pasted link is about, judged by the LANDING page's URL and
  // title across every product found (see primary-product.ts).
  // A Shopify feed product IS the linked product; otherwise judge the evidence.
  const primaryIndex = shopify || pageProduct
    ? 0
    : identifyPrimaryProduct(collected, crawl.finalUrl, meta.title, { soleLandingProduct: landingCount === 1 })
  const primary = primaryIndex === -1 ? null : collected[primaryIndex]
  const products = withPrimaryFirst(collected, primaryIndex)

  // On a product page, other pages' share images are site banners (about us, get a
  // quote), not product imagery; they would only dilute the reference set.
  const heroImages: string[] = primary ? [...meta.ogImages] : [...meta.ogImages, ...otherPageImages]

  // Product imagery from structured data is the most reliable, then OpenGraph,
  // then whatever the page's largest images happen to be.
  const productImages = primary ? primary.images : products.flatMap((product) => product.images)
  // Not on a product page: there the page's other large images are mostly
  // related-product thumbnails, i.e. different products.
  const fallbackImages =
    !primary && productImages.length + heroImages.length < 3
      ? extractContentImages(landing$, landing.url)
      : []

  const images = unique([...productImages, ...heroImages, ...fallbackImages]).slice(0, 8)

  return {
    url: rawUrl,
    finalUrl: crawl.finalUrl,
    title: meta.title,
    description: meta.description,
    siteName: meta.siteName ?? brand?.name ?? null,
    language: meta.language,
    colors,
    typography,
    heroImages: images,
    logo: meta.logo ?? brand?.logo ?? null,
    products,
    hasPrimaryProduct: Boolean(primary),
    referenceImages: selectReferenceImages(primary, meta.ogImages),
    brand,
    excerpt: extractReadableText(landing$),
    pagesVisited: crawl.pages.map((page) => page.url),
    notes: crawl.notes,
    summary: buildSummary({ meta, brand, products, primary, pageCount: crawl.pages.length }),
    extractedAt: new Date().toISOString(),
  }
}

/**
 * One-line human summary for the UI.
 *
 * Deliberately built from facts rather than a model call: the analyser runs before
 * any brief exists, and spending a request here would slow the one moment the user
 * is actively waiting.
 */
function buildSummary(input: {
  meta: { title: string | null; description: string | null; siteName: string | null }
  brand: BrandFacts | null
  products: ProductFacts[]
  primary: ProductFacts | null
  pageCount: number
}): string {
  const name = input.brand?.name ?? input.meta.siteName ?? input.meta.title
  const parts: string[] = []

  if (name) parts.push(name)
  if (input.primary?.name) {
    parts.push(`product: ${input.primary.name}`)
  } else if (input.products.length === 1 && input.products[0].name) {
    parts.push(`product: ${input.products[0].name}`)
  } else if (input.products.length > 1) {
    parts.push(`${input.products.length} products found`)
  }
  parts.push(`${input.pageCount} page${input.pageCount === 1 ? "" : "s"} read`)

  const summary = parts.join(" · ")
  return summary || input.meta.description?.slice(0, 200) || "Public brand page analysed."
}
