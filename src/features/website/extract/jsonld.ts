import type { CheerioAPI } from "cheerio"

/**
 * schema.org extraction from JSON-LD.
 *
 * This is the single highest-value signal on any commerce site and the previous
 * analyser missed it entirely — it regex-matched `<title>`, some hex colours and
 * a meta description, then threw the result away. Shopify, WooCommerce, BigCommerce
 * and most headless storefronts all publish a full `Product` graph: name, brand,
 * description, price, availability and image set, already structured. Reading it is
 * strictly better than asking a model to infer the same facts from prose.
 */

export type ProductFacts = {
  name: string | null
  brand: string | null
  description: string | null
  category: string | null
  sku: string | null
  price: { amount: number; currency: string } | null
  availability: string | null
  images: string[]
}

export type BrandFacts = {
  name: string | null
  logo: string | null
  description: string | null
  /** Social and external profile URLs, useful for tone-of-voice context. */
  sameAs: string[]
}

export type JsonLdResult = {
  products: ProductFacts[]
  brand: BrandFacts | null
}

/** Cap so a category page publishing hundreds of products cannot dominate. */
const MAX_PRODUCTS = 6

export function extractJsonLd($: CheerioAPI, baseUrl: string): JsonLdResult {
  const nodes = collectNodes($)

  const products: ProductFacts[] = []
  let brand: BrandFacts | null = null

  for (const node of nodes) {
    const types = typesOf(node)

    if (types.some((type) => type === "product" || type === "productgroup")) {
      if (products.length < MAX_PRODUCTS) products.push(toProduct(node, baseUrl))
    }

    // Organization is usually in the site-wide graph; the first one wins because
    // a page may also describe partner or publisher organisations.
    if (!brand && types.some((type) => type === "organization" || type === "brand")) {
      brand = toBrand(node, baseUrl)
    }
  }

  return { products, brand }
}

/**
 * Flatten every JSON-LD block into a list of nodes.
 *
 * Real sites nest arbitrarily: a top-level array, an `@graph`, `mainEntity`,
 * `itemListElement`, or a `Product` hanging off a `BreadcrumbList`. Walking the
 * whole structure and matching on `@type` is far more robust than assuming any
 * particular envelope.
 */
function collectNodes($: CheerioAPI): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = []

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim()
    if (!raw) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Malformed JSON-LD is extremely common and never worth failing over.
      return
    }

    walk(parsed, nodes, 0)
  })

  return nodes
}

/** Bounded so a self-referential or pathological document cannot hang a worker. */
const MAX_DEPTH = 8

function walk(value: unknown, sink: Record<string, unknown>[], depth: number) {
  if (depth > MAX_DEPTH || sink.length > 400) return

  if (Array.isArray(value)) {
    for (const item of value) walk(item, sink, depth + 1)
    return
  }

  if (!value || typeof value !== "object") return

  const record = value as Record<string, unknown>
  if ("@type" in record) sink.push(record)

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") walk(nested, sink, depth + 1)
  }
}

function typesOf(node: Record<string, unknown>): string[] {
  const raw = node["@type"]
  const values = Array.isArray(raw) ? raw : [raw]
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.split("/").pop()!.toLowerCase())
}

function toProduct(node: Record<string, unknown>, baseUrl: string): ProductFacts {
  const offers = firstOffer(node.offers)

  return {
    name: text(node.name),
    // `brand` is sometimes a bare string and sometimes a nested Brand node.
    brand: text(node.brand) ?? text(asRecord(node.brand)?.name),
    description: text(node.description),
    category: text(node.category),
    sku: text(node.sku) ?? text(node.mpn) ?? text(node.gtin13),
    price: offers ? toPrice(offers) : null,
    availability: text(offers?.availability)?.split("/").pop() ?? null,
    images: imageUrls(node.image, baseUrl),
  }
}

function toBrand(node: Record<string, unknown>, baseUrl: string): BrandFacts {
  const logo = node.logo
  const logoUrl = typeof logo === "string" ? logo : text(asRecord(logo)?.url)

  return {
    name: text(node.name),
    logo: logoUrl ? absolute(logoUrl, baseUrl) : null,
    description: text(node.description),
    sameAs: (Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs])
      .filter((value): value is string => typeof value === "string")
      .slice(0, 8),
  }
}

/** Offers may be a single node, an array, or an AggregateOffer wrapper. */
function firstOffer(offers: unknown): Record<string, unknown> | null {
  if (Array.isArray(offers)) return asRecord(offers[0])
  return asRecord(offers)
}

function toPrice(offer: Record<string, unknown>): ProductFacts["price"] {
  const raw = offer.price ?? offer.lowPrice ?? asRecord(offer.priceSpecification)?.price
  const amount = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^0-9.]/g, ""))
  const currency =
    text(offer.priceCurrency) ?? text(asRecord(offer.priceSpecification)?.priceCurrency)

  if (!Number.isFinite(amount) || amount <= 0 || !currency) return null
  return { amount, currency }
}

function imageUrls(image: unknown, baseUrl: string): string[] {
  const candidates = Array.isArray(image) ? image : [image]
  return candidates
    .map((entry) => (typeof entry === "string" ? entry : text(asRecord(entry)?.url)))
    .filter((value): value is string => Boolean(value))
    .map((value) => absolute(value, baseUrl))
    .filter((value): value is string => Boolean(value))
    .slice(0, 6)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Collapse whitespace and cap length; JSON-LD descriptions can be enormous. */
function text(value: unknown): string | null {
  if (typeof value === "number") return String(value)
  if (typeof value !== "string") return null
  const cleaned = value.replace(/\s+/g, " ").trim()
  return cleaned ? cleaned.slice(0, 1200) : null
}

export function absolute(value: string, baseUrl: string): string | null {
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return null
  }
}
