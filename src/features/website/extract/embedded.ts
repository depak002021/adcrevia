import type { CheerioAPI } from "cheerio"

import { absolute, type ProductFacts } from "./jsonld"

/**
 * Products embedded as JSON in the page itself.
 *
 * Storefronts built with React/Next.js, Vue and headless commerce often publish no
 * JSON-LD, but ship the product in the HTML as data for the browser app:
 * `__NEXT_DATA__`, `<script type="application/json">` state blobs. Reading that data
 * gives the name, photos and price without running the page's JavaScript, i.e.
 * without a browser on the server.
 *
 * An object counts as a product only with a name, image URLs, and a commerce signal
 * (price, SKU, offers or variants) — so navigation menus, banners and reviews inside
 * the same data are not mistaken for products. Bounded in size, depth and count.
 */

const MAX_SCRIPT_BYTES = 2_000_000
const MAX_SCRIPTS = 12
const MAX_NODES = 25_000
const MAX_DEPTH = 14
const MAX_PRODUCTS = 6

const NAME_KEYS = ["name", "title", "productName"]
const IMAGE_KEYS = ["images", "image", "featuredImage", "featured_image", "media", "gallery", "imageUrl", "img", "photos"]
const COMMERCE_KEYS = ["price", "offers", "sku", "variants", "priceRange", "compareAtPrice", "salePrice", "mrp", "sellingPrice"]
const URL_KEYS = ["url", "src", "originalSrc", "transformedSrc", "href", "large", "zoom", "full"]

export function extractEmbeddedProducts($: CheerioAPI, baseUrl: string): ProductFacts[] {
  const blobs: unknown[] = []
  $('script#__NEXT_DATA__, script[type="application/json"]')
    .slice(0, MAX_SCRIPTS)
    .each((_, element) => {
      const text = $(element).text()
      if (!text || text.length > MAX_SCRIPT_BYTES) return
      try {
        blobs.push(JSON.parse(text))
      } catch {
        // Not JSON after all; ignore.
      }
    })
  return productsInData(blobs, baseUrl)
}

export function productsInData(blobs: unknown[], baseUrl: string): ProductFacts[] {
  const products: ProductFacts[] = []
  let visited = 0

  const walk = (value: unknown, depth: number) => {
    if (products.length >= MAX_PRODUCTS || visited > MAX_NODES || depth > MAX_DEPTH) return
    visited += 1
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    if (!value || typeof value !== "object") return
    const node = value as Record<string, unknown>
    const product = asProduct(node, baseUrl)
    if (product) {
      if (!products.some((existing) => existing.name === product.name)) products.push(product)
      return
    }
    for (const child of Object.values(node)) walk(child, depth + 1)
  }

  for (const blob of blobs) walk(blob, 0)
  return products
}

function asProduct(node: Record<string, unknown>, baseUrl: string): ProductFacts | null {
  const name = NAME_KEYS.map((key) => node[key]).find((value): value is string => typeof value === "string" && value.trim().length >= 3 && value.length <= 200)
  if (!name) return null
  if (!COMMERCE_KEYS.some((key) => node[key] !== undefined && node[key] !== null)) return null
  const images = collectImages(IMAGE_KEYS.map((key) => node[key]), baseUrl)
  if (images.length === 0) return null

  return {
    name: name.trim(),
    brand: stringOf(node.brand) ?? stringOf((node.brand as Record<string, unknown> | undefined)?.name) ?? stringOf(node.vendor),
    description: stringOf(node.description)?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000) ?? null,
    category: stringOf(node.category) ?? stringOf(node.productType) ?? stringOf(node.product_type),
    sku: stringOf(node.sku),
    price: priceOf(node),
    availability: null,
    images: images.slice(0, 8),
  }
}

function collectImages(values: unknown[], baseUrl: string): string[] {
  const found: string[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || found.length >= 12) return
    if (typeof value === "string") {
      if (/^(https?:)?\/\//.test(value) && !/\.svg(\?|$)/i.test(value)) {
        const url = absolute(value.startsWith("//") ? `https:${value}` : value, baseUrl)
        if (url && !found.includes(url)) found.push(url)
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>
      for (const key of URL_KEYS) if (typeof record[key] === "string") visit(record[key], depth + 1)
      // GraphQL-style { edges: [{ node: { url } }] } and { nodes: [...] }.
      for (const key of ["edges", "nodes", "node", "image"]) if (record[key] !== undefined) visit(record[key], depth + 1)
    }
  }
  for (const value of values) visit(value, 0)
  return found
}

function priceOf(node: Record<string, unknown>): ProductFacts["price"] {
  const raw = node.price ?? node.salePrice ?? node.sellingPrice ?? (node.priceRange as Record<string, unknown> | undefined)?.minVariantPrice
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null
  const amount = Number(record ? (record.amount ?? record.value) : raw)
  const currency = stringOf(record?.currencyCode) ?? stringOf(record?.currency) ?? stringOf(node.currency) ?? stringOf(node.currencyCode)
  return Number.isFinite(amount) && amount > 0 && currency ? { amount, currency } : null
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
