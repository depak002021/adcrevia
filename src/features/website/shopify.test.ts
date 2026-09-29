import { describe, expect, it, vi } from "vitest"

import { fetchShopifyProduct, shopifyHandle, shopifyProductFrom } from "./shopify"

describe("Shopify product feed", () => {
  it("recognises product links", () => {
    expect(shopifyHandle("https://brand.example/products/holi-tee?variant=1")).toEqual({ origin: "https://brand.example", handle: "holi-tee" })
    expect(shopifyHandle("https://brand.example/collections/all/products/holi-tee")).toEqual({ origin: "https://brand.example", handle: "holi-tee" })
    expect(shopifyHandle("https://brand.example/about")).toBeNull()
  })

  it("maps the feed to a product with full-size photos", () => {
    const product = shopifyProductFrom({ title: "Holi Tee", vendor: "Brand", type: "T-Shirts", description: "<p>Soft <b>cotton</b></p>", available: true, images: ["//cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"], variants: [{ sku: "HT-1" }] })
    expect(product).toEqual({ name: "Holi Tee", brand: "Brand", description: "Soft cotton", category: "T-Shirts", sku: "HT-1", price: null, availability: "InStock", images: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"] })
  })

  it("returns nothing for non-Shopify stores without failing the analysis", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 404, text: async () => "" }))
    await expect(fetchShopifyProduct("https://brand.example/products/x", fetcher)).resolves.toBeNull()
    await expect(fetchShopifyProduct("https://brand.example/about", fetcher)).resolves.toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
