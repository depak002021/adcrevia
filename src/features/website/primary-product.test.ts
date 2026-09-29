import { describe, expect, it } from "vitest"

import type { ProductFacts } from "./extract/jsonld"
import { identifyPrimaryProduct, selectReferenceImages, withPrimaryFirst } from "./primary-product"

function product(name: string, sku: string | null = null, images: string[] = []): ProductFacts {
  return { name, sku, images, brand: null, description: null, category: null, price: null, availability: null }
}

// Shaped like the real factori.com page: the linked shirt is second of six.
const factori = [
  product("Classic Happy Holi Splash Polyester T-Shirt 140 GSM Round Neck White", "SKUFACTORI4428"),
  product("Color Splash Happy Holi Polyester T-Shirt 140 GSM Round Neck White", "SKUFACTORI4423"),
  product("Colorful Handprint Happy Holi Festival Polyester T-Shirt", "SKUFACTORI4453"),
]
const factoriUrl = "https://factori.com/t-shirts/color-splash-happy-holi-polyester-t-shirt-140-gsm-round-neck-white-skufactori4423"

describe("identifyPrimaryProduct", () => {
  it("picks the product whose SKU is in the URL, not the first related product", () => {
    expect(identifyPrimaryProduct(factori, factoriUrl, "Something else entirely")).toBe(1)
  })

  it("falls back to the product named in the page title", () => {
    const products = [product("Linen Shirt"), product("Merino Crew Sweater")]
    expect(identifyPrimaryProduct(products, "https://shop.example/p/123", "Merino Crew Sweater | Shop")).toBe(1)
  })

  it("treats the landing page's lone product as the primary one", () => {
    expect(identifyPrimaryProduct([product("Only Thing")], "https://shop.example/x", null, { soleLandingProduct: true })).toBe(0)
  })

  it("does not adopt a single product that was only found on another crawled page", () => {
    expect(identifyPrimaryProduct([product("Only Thing")], "https://shop.example/", "Shop | Home")).toBe(-1)
  })

  it("matches the real factori title against its product name despite wording differences", () => {
    const title = "Color Splash Happy Holi Polyester T-Shirt 140 GSM White | factori.com"
    expect(identifyPrimaryProduct(factori, "https://factori.com/p/other", title)).toBe(1)
  })

  it("names no product on a category page with several unrelated items", () => {
    const products = [product("Linen Shirt"), product("Merino Crew Sweater")]
    expect(identifyPrimaryProduct(products, "https://shop.example/collections/all", "All products")).toBe(-1)
    expect(identifyPrimaryProduct([], factoriUrl, null)).toBe(-1)
  })

  it("ignores SKUs too short to be meaningful in a URL", () => {
    const products = [product("Mug", "12"), product("Plate", "34")]
    expect(identifyPrimaryProduct(products, "https://shop.example/items/1234", null)).toBe(-1)
  })
})

describe("withPrimaryFirst", () => {
  it("moves the primary product to the front and keeps the rest in order", () => {
    expect(withPrimaryFirst(factori, 1).map((item) => item.sku)).toEqual(["SKUFACTORI4423", "SKUFACTORI4428", "SKUFACTORI4453"])
    expect(withPrimaryFirst(factori, -1)).toBe(factori)
  })
})

describe("selectReferenceImages", () => {
  it("uses only the product's own images and the page's share image, capped at four", () => {
    const primary = product("Shirt", "S1", ["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"])
    expect(selectReferenceImages(primary, ["https://cdn/a.jpg", "https://cdn/og.jpg", "https://cdn/og2.jpg"])).toEqual([
      "https://cdn/a.jpg",
      "https://cdn/b.jpg",
      "https://cdn/c.jpg",
      "https://cdn/og.jpg",
    ])
  })

  it("returns nothing when the page is not about one product", () => {
    expect(selectReferenceImages(null, ["https://cdn/og.jpg"])).toEqual([])
  })
})
