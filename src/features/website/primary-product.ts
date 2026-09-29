import type { ProductFacts } from "./extract/jsonld"
import { unique } from "./extract/page"

/**
 * Which product is this page actually about?
 *
 * A product page publishes structured data for more than its own item: "related
 * products", "you may also like" and bundle carousels all emit `Product` nodes, and
 * they usually come first in the document. On a real storefront (factori.com) the
 * linked shirt was the second of six, so taking `products[0]` briefed the model on a
 * different product than the one the user pasted.
 *
 * Evidence, strongest first:
 *   1. The product's SKU appears in the URL path (…-skufactori4423).
 *   2. The product's name matches the page title (80% of the title's words).
 *   3. The landing page itself describes exactly one product.
 *
 * `products` may include products found on other crawled pages: some shops publish
 * no structured data on the product page itself but do on their listings, which is
 * where the linked product's facts then come from. The URL and title are always the
 * LANDING page's, so they still identify which one was linked.
 *
 * Returns the index into `products`, or -1 when the page is not a single-product page
 * (a home or category page) — in which case nothing is treated as "the product".
 */
export function identifyPrimaryProduct(
  products: ProductFacts[],
  pageUrl: string,
  pageTitle: string | null,
  /** The landing page itself describes exactly one product, and it is `products[0]`. */
  options: { soleLandingProduct?: boolean } = {},
): number {
  if (products.length === 0) return -1

  const path = safePath(pageUrl)
  const bySku = products.findIndex((product) => {
    const sku = normalize(product.sku)
    return sku.length >= 4 && path.includes(sku)
  })
  if (bySku !== -1) return bySku

  const titleTokens = tokens(stripSiteSuffix(pageTitle))
  if (titleTokens.length >= 2) {
    let best = -1
    let bestScore = 0
    products.forEach((product, index) => {
      const nameTokens = new Set(tokens(product.name))
      if (nameTokens.size === 0) return
      // Share of the title's words that the product name also uses. Tolerates the
      // small differences shops make between a page title and a product name
      // ("… 140 GSM White" vs "… 140 GSM Round Neck White").
      const score = titleTokens.filter((token) => nameTokens.has(token)).length / titleTokens.length
      if (score > bestScore) {
        best = index
        bestScore = score
      }
    })
    if (bestScore >= 0.8) return best
  }

  // Only the landing page's own lone product counts: one product found while
  // crawling onward from a home page says nothing about what the link is for.
  return options.soleLandingProduct ? 0 : -1
}

/** Primary product first, the rest in their original order. */
export function withPrimaryFirst(products: ProductFacts[], primaryIndex: number): ProductFacts[] {
  if (primaryIndex <= 0) return products
  return [products[primaryIndex], ...products.filter((_, index) => index !== primaryIndex)]
}

/** At most this many photos are sent to a generator as the product reference. */
export const MAX_REFERENCE_IMAGES = 4

/**
 * Photos that show THE product, for use as generation references.
 *
 * Only the primary product's own structured images and the page's own share image
 * (on a product page, `og:image` is the product shot). Deliberately not the page's
 * other large images: on a product page those are mostly related-product thumbnails,
 * and handing a model a different shirt as "the product" is worse than no reference.
 * A page with no identifiable product yields none.
 */
export function selectReferenceImages(primary: ProductFacts | null, landingOgImages: string[]): string[] {
  if (!primary) return []
  return unique([...primary.images, ...landingOgImages]).slice(0, MAX_REFERENCE_IMAGES)
}

/** "Product name | Shop" / "Product name – Shop" → "Product name". */
function stripSiteSuffix(title: string | null): string {
  return (title ?? "").split(/\s[|–—-]\s/)[0] ?? ""
}

function tokens(value: string | null | undefined): string[] {
  return (value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1)
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function safePath(url: string): string {
  try {
    const parsed = new URL(url)
    return normalize(decodeURIComponent(parsed.pathname))
  } catch {
    return normalize(url)
  }
}
