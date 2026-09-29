import * as cheerio from "cheerio"
import { describe, expect, it } from "vitest"

import { extractJsonLd } from "./jsonld"
import { extractContentImages, extractPageMeta, extractReadableText } from "./page"
import { extractColors, extractTypography } from "./style"

const BASE = "https://brand.example/products/aurora"

function load(html: string) {
  return cheerio.load(html)
}

describe("extractJsonLd", () => {
  it("reads a Product from a plain JSON-LD block", () => {
    const $ = load(`
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Aurora Eau de Parfum",
        "description": "A nocturnal floral in smoked glass.",
        "sku": "AUR-100",
        "category": "Fragrance",
        "brand": { "@type": "Brand", "name": "Lumen" },
        "image": ["/img/aurora-1.jpg", "https://cdn.example/aurora-2.jpg"],
        "offers": { "@type": "Offer", "price": "148.00", "priceCurrency": "GBP", "availability": "https://schema.org/InStock" }
      }
      </script>`)

    const { products } = extractJsonLd($, BASE)

    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      name: "Aurora Eau de Parfum",
      // Nested Brand node, not a bare string.
      brand: "Lumen",
      sku: "AUR-100",
      category: "Fragrance",
      price: { amount: 148, currency: "GBP" },
      // The schema.org URL prefix is stripped to a bare token.
      availability: "InStock",
    })
    // Relative image paths are resolved against the page URL.
    expect(products[0].images).toEqual([
      "https://brand.example/img/aurora-1.jpg",
      "https://cdn.example/aurora-2.jpg",
    ])
  })

  it("finds a Product nested inside an @graph", () => {
    // Shopify and most headless storefronts publish an @graph rather than a bare
    // node, which the previous regex approach could never have reached.
    const $ = load(`
      <script type="application/ld+json">
      { "@context": "https://schema.org", "@graph": [
        { "@type": "WebSite", "name": "Lumen" },
        { "@type": "Organization", "name": "Lumen", "logo": { "@type": "ImageObject", "url": "/logo.svg" }, "sameAs": ["https://instagram.com/lumen"] },
        { "@type": "BreadcrumbList", "itemListElement": [
          { "@type": "ListItem", "item": { "@type": "Product", "name": "Deep Graph Product" } }
        ]}
      ]}
      </script>`)

    const { products, brand } = extractJsonLd($, BASE)

    expect(products.map((product) => product.name)).toContain("Deep Graph Product")
    expect(brand).toMatchObject({
      name: "Lumen",
      logo: "https://brand.example/logo.svg",
      sameAs: ["https://instagram.com/lumen"],
    })
  })

  it("survives malformed JSON without failing the whole extraction", () => {
    // Broken JSON-LD is extremely common and must never abort an analysis.
    const $ = load(`
      <script type="application/ld+json">{ this is not json </script>
      <script type="application/ld+json">{"@type":"Product","name":"Still Found"}</script>`)

    expect(extractJsonLd($, BASE).products.map((p) => p.name)).toEqual(["Still Found"])
  })

  it("ignores an offer with an unusable price rather than inventing zero", () => {
    const $ = load(`
      <script type="application/ld+json">
      {"@type":"Product","name":"No Price","offers":{"@type":"Offer","price":"Call us","priceCurrency":"USD"}}
      </script>`)

    expect(extractJsonLd($, BASE).products[0].price).toBeNull()
  })
})

describe("extractPageMeta", () => {
  it("prefers OpenGraph over the raw title tag", () => {
    // <title> usually carries site boilerplate; og:title is the curated headline.
    const $ = load(`
      <html lang="en-GB"><head>
        <title>Aurora EDP — Lumen — Free UK shipping over £50</title>
        <meta property="og:title" content="Aurora Eau de Parfum" />
        <meta property="og:site_name" content="Lumen" />
        <meta property="og:image" content="/og/aurora.jpg" />
        <link rel="apple-touch-icon" href="/touch-icon.png" />
      </head></html>`)

    expect(extractPageMeta($, BASE)).toMatchObject({
      title: "Aurora Eau de Parfum",
      siteName: "Lumen",
      language: "en-GB",
      ogImages: ["https://brand.example/og/aurora.jpg"],
      // apple-touch-icon beats favicon: it is a real raster asset at usable size.
      logo: "https://brand.example/touch-icon.png",
    })
  })

  it("falls back to the title tag and meta description", () => {
    const $ = load(`
      <head><title>Lumen</title><meta name="description" content="Fragrance house." /></head>`)

    expect(extractPageMeta($, BASE)).toMatchObject({
      title: "Lumen",
      description: "Fragrance house.",
    })
  })
})

describe("extractContentImages", () => {
  it("ranks by declared area and drops icons and SVGs", () => {
    const $ = load(`
      <img src="/hero.jpg" width="1600" height="900" />
      <img src="/thumb.jpg" width="400" height="400" />
      <img src="/icon.jpg" width="48" height="48" />
      <img src="/logo.svg" width="800" height="200" />`)

    expect(extractContentImages($, BASE)).toEqual([
      "https://brand.example/hero.jpg",
      "https://brand.example/thumb.jpg",
    ])
  })

  it("reads the first candidate from a srcset when src is absent", () => {
    // Lazy-loaded heroes routinely ship srcset with no src.
    const $ = load(`<img srcset="/wide.jpg 1600w, /narrow.jpg 800w" width="1600" height="900" />`)

    expect(extractContentImages($, BASE)).toEqual(["https://brand.example/wide.jpg"])
  })
})

describe("extractColors", () => {
  it("ranks by usage and discards near-neutrals", () => {
    // The old implementation took the first eight hex literals, which on a real
    // page are the reset greys. Frequency plus a saturation floor finds the accent.
    const $ = load(`
      <style>
        :root { color: #000000; background: #FFFFFF; border-color: #E5E5E5; }
        .btn { background: #D8F651; }
        .btn:hover { background: #D8F651; }
        .link { color: #D8F651; }
        .badge { background: rgb(160, 40, 220); }
      </style>`)

    const colors = extractColors($)
    const hexes = colors.map((color) => color.hex)

    expect(hexes[0]).toBe("#D8F651")
    expect(hexes).toContain("#A028DC")
    // Black, white and the hairline grey are page furniture, not brand colours.
    expect(hexes).not.toContain("#000000")
    expect(hexes).not.toContain("#FFFFFF")
    expect(hexes).not.toContain("#E5E5E5")
  })

  it("expands shorthand hex and weights theme-color heavily", () => {
    const $ = load(`
      <head><meta name="theme-color" content="#0A8" /></head>
      <style>.x { color: #1166EE; }</style>`)

    const colors = extractColors($)
    // Shorthand #0A8 expands to #00AA88, and theme-color is an explicit brand
    // declaration so it should outrank an incidental stylesheet colour.
    expect(colors[0].hex).toBe("#00AA88")
  })
})

describe("extractTypography", () => {
  it("keeps real faces and drops generic families", () => {
    const $ = load(`
      <style>
        body { font-family: "Aeonik Pro", Helvetica, sans-serif; }
        code { font-family: monospace; }
        @font-face { font-family: "Lumen Display"; src: url(/f.woff2); }
      </style>`)

    const faces = extractTypography($)

    expect(faces).toContain("Aeonik Pro")
    expect(faces).toContain("Helvetica")
    expect(faces).toContain("Lumen Display")
    expect(faces).not.toContain("sans-serif")
    expect(faces).not.toContain("monospace")
  })

  it("reads webfont names from a Google Fonts link", () => {
    // The face is named in the href even when the CSS itself is external.
    const $ = load(
      `<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">`,
    )

    expect(extractTypography($)).toContain("Instrument Serif")
  })
})

describe("extractReadableText", () => {
  it("strips chrome and script content", () => {
    const $ = load(`
      <body>
        <nav>Home Shop Cart</nav>
        <script>window.analytics = 1</script>
        <main><p>Aurora is built around smoked glass and restraint.</p></main>
        <footer>Terms Privacy</footer>
      </body>`)

    const text = extractReadableText($)

    expect(text).toContain("smoked glass and restraint")
    // Navigation labels and cookie banners are what made the old excerpt useless.
    expect(text).not.toContain("Home Shop Cart")
    expect(text).not.toContain("window.analytics")
    expect(text).not.toContain("Terms Privacy")
  })
})
