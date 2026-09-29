import * as cheerio from "cheerio"
import { describe, expect, it } from "vitest"

import { extractPageMeta } from "./page"
import { extractPageProduct } from "./page-product"

const url = "https://shop.example/casserole/red-chef-insulated-casserole-2000ml-sku10968"
const cdn = "https://cdn.example"

const html = `<html><head>
<title>Red Chef 2000ML Insulated Casserole Bulk | shop.example</title>
<meta property="og:title" content="Red Chef 2000ML Insulated Casserole Bulk | shop.example" />
<meta property="og:description" content="Double-walled stainless steel casserole keeps food hot or cold." />
<meta property="og:image" content="${cdn}/Red-Chef-Insulated-Casserole-2000ML-10968-1-a.webp?v=1" />
</head><body>
<h1>Red Chef Hot And Cold Insulated Casserole 2000ML</h1>
<div class="gal" data-images="[&quot;https:\\/\\/cdn.example\\/Red-Chef-Insulated-Casserole-2000ML-10968-1-a.webp&quot;,&quot;https:\\/\\/cdn.example\\/Red-Chef-Insulated-Casserole-2000ML-10968-0-b.webp&quot;]"></div>
<img src="${cdn}/Red-Chef-Insulated-Casserole-3000ML-10969-0-c.webp" />
<img src="${cdn}/site-logo.png" />
<p>MOQ 50 · Price ₹ 420 · Get a quote</p>
</body></html>`

function read(page: string, pageUrl: string) {
  const $ = cheerio.load(page)
  return extractPageProduct($, page, pageUrl, extractPageMeta($, pageUrl), $("body").text())
}

describe("product from a page without structured data", () => {
  it("names the product from its headline and keeps only this variant's photos", () => {
    const product = read(html, url)
    expect(product?.name).toBe("Red Chef Hot And Cold Insulated Casserole 2000ML")
    expect(product?.description).toContain("Double-walled")
    expect(product?.images).toEqual([
      `${cdn}/Red-Chef-Insulated-Casserole-2000ML-10968-1-a.webp?v=1`,
      `${cdn}/Red-Chef-Insulated-Casserole-2000ML-10968-0-b.webp`,
    ])
  })

  it("does not treat a blog post as a product", () => {
    expect(read(html, "https://shop.example/blog/2026/07/how-to-choose-an-insulated-casserole")).toBeNull()
  })

  it("needs something to buy on the page", () => {
    expect(read(html.replace("<p>MOQ 50 · Price ₹ 420 · Get a quote</p>", "<p>Our story</p>"), url)).toBeNull()
  })
})
