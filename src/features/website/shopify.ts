import type { ProductFacts } from "./extract/jsonld"
import { readCappedText, safeFetch } from "./safe-fetch"

/**
 * Shopify's public product feed.
 *
 * Every Shopify store answers `/products/<handle>.js` with the product as JSON:
 * title, vendor, type, price and every product photo at full resolution. For a
 * Shopify product link that is more complete and more reliable than the page,
 * which may render its gallery with JavaScript. Read-only, public, one request.
 */

const MAX_BYTES = 2_000_000

export function shopifyHandle(url: string): { origin: string; handle: string } | null {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/\/products\/([a-z0-9][a-z0-9._-]*)\/?$/i)
    return match ? { origin: parsed.origin, handle: match[1] } : null
  } catch {
    return null
  }
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export async function fetchShopifyProduct(pageUrl: string, fetcher: Fetcher = defaultFetcher): Promise<ProductFacts | null> {
  const target = shopifyHandle(pageUrl)
  if (!target) return null
  try {
    const response = await fetcher(`${target.origin}/products/${target.handle}.js`)
    if (!response.ok) return null
    return shopifyProductFrom(JSON.parse(await response.text()))
  } catch {
    // Not a Shopify store, or the feed is disabled: the page analysis stands alone.
    return null
  }
}

export function shopifyProductFrom(data: unknown): ProductFacts | null {
  if (!data || typeof data !== "object") return null
  const product = data as Record<string, unknown>
  if (typeof product.title !== "string" || !Array.isArray(product.images)) return null
  const images = product.images
    .filter((url): url is string => typeof url === "string")
    .map((url) => (url.startsWith("//") ? `https:${url}` : url))
    .filter((url) => url.startsWith("https://"))
  const variants = Array.isArray(product.variants) ? (product.variants as Array<Record<string, unknown>>) : []
  return {
    name: product.title,
    brand: typeof product.vendor === "string" ? product.vendor : null,
    description: typeof product.description === "string" ? product.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000) : null,
    category: typeof product.type === "string" && product.type ? product.type : null,
    sku: typeof variants[0]?.sku === "string" && variants[0].sku ? (variants[0].sku as string) : null,
    // The feed gives the price in minor units but not the currency; the page does.
    price: null,
    availability: product.available === true ? "InStock" : product.available === false ? "OutOfStock" : null,
    images: images.slice(0, 8),
  }
}

async function defaultFetcher(url: string) {
  // safeFetch does not follow redirects; a store may redirect to its primary domain.
  let current = url
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await safeFetch(current, { headers: { accept: "application/json" } })
    const location = response.headers.get("location")
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {})
      current = new URL(location, current).toString()
      continue
    }
    return { ok: response.ok, status: response.status, text: () => readCappedText(response, MAX_BYTES) }
  }
  throw new Error("WEBSITE_REDIRECT_LIMIT")
}
