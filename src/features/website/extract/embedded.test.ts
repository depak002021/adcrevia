import * as cheerio from "cheerio"
import { describe, expect, it } from "vitest"

import { extractEmbeddedProducts, productsInData } from "./embedded"

describe("extractEmbeddedProducts", () => {
  it("reads a product from Next.js page data", () => {
    const data = { props: { pageProps: { product: { title: "Linen Overshirt", sku: "LN-01", price: { amount: "2499", currencyCode: "INR" }, images: { edges: [{ node: { url: "//cdn.shop/a.jpg" } }, { node: { url: "https://cdn.shop/b.jpg" } }] } } } } }
    const $ = cheerio.load(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`)
    expect(extractEmbeddedProducts($, "https://shop.example/p/linen")).toEqual([
      expect.objectContaining({ name: "Linen Overshirt", sku: "LN-01", price: { amount: 2499, currency: "INR" }, images: ["https://cdn.shop/a.jpg", "https://cdn.shop/b.jpg"] }),
    ])
  })

  it("ignores menus and banners that have a name and an image but nothing to buy", () => {
    const data = { nav: [{ name: "Summer sale", image: "https://cdn/banner.jpg" }], hero: { title: "New in", images: ["https://cdn/hero.jpg"] } }
    expect(productsInData([data], "https://shop.example")).toEqual([])
  })

  it("tolerates broken JSON and deeply nested data", () => {
    const $ = cheerio.load('<script type="application/json">{not json</script>')
    expect(extractEmbeddedProducts($, "https://x.example")).toEqual([])
    let deep: Record<string, unknown> = { name: "Deep", price: 1, image: "https://cdn/x.jpg" }
    for (let i = 0; i < 40; i += 1) deep = { child: deep }
    expect(productsInData([deep], "https://x.example")).toEqual([])
  })
})
