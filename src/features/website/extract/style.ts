import type { CheerioAPI } from "cheerio"

/**
 * Brand colour and typeface extraction.
 *
 * The previous implementation took the first eight `#RRGGBB` literals it found
 * anywhere in the HTML. On a real site the earliest hex values are almost always
 * inside an inlined critical-CSS reset — greys, borders, shadow tints — so the
 * "brand palette" it produced was usually `#000000`, `#FFFFFF` and a few
 * hairline greys.
 *
 * Counting occurrences and discarding near-neutrals gets much closer to the
 * colours a person would name if asked. Frequency is a decent proxy for intent:
 * the accent appears on every button, the reset grey appears once.
 */

export type ColorWeight = { hex: string; weight: number }

/** Below this saturation a colour is structural, not brand. */
const MIN_SATURATION = 0.18

/** Near-black and near-white are page furniture on every site. */
const MIN_LIGHTNESS = 0.08
const MAX_LIGHTNESS = 0.94

export function extractColors($: CheerioAPI, limit = 6): ColorWeight[] {
  const counts = new Map<string, number>()

  // Only style-bearing sources, not the whole document. Scanning all markup picks
  // up hex strings from analytics payloads, inline SVG paths and data attributes.
  const sources: string[] = []
  // Block bodies, not expression bodies: cheerio treats a returned value as a
  // break signal, and `push` returns the new length — which would stop iteration
  // after the first element.
  $("style").each((_, element) => {
    sources.push($(element).contents().text())
  })
  $("[style]").each((_, element) => {
    const value = $(element).attr("style")
    if (value) sources.push(value)
  })
  // Theme colour is an explicit declaration of the brand hue.
  const themeColor = $('meta[name="theme-color"]').attr("content")
  if (themeColor) sources.push(themeColor, themeColor, themeColor) // weight it up

  for (const source of sources) {
    for (const hex of source.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      const normalized = normalizeHex(hex[1])
      if (!normalized) continue
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }
    for (const rgb of source.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
      const normalized = toHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]))
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .filter(([hex]) => isBrandColor(hex))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex, weight]) => ({ hex, weight }))
}

function normalizeHex(body: string): string | null {
  const expanded =
    body.length === 3
      ? body
          .split("")
          .map((character) => character + character)
          .join("")
      : body
  return expanded.length === 6 ? `#${expanded.toUpperCase()}` : null
}

function toHex(r: number, g: number, b: number): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

function isBrandColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const delta = max - min
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))

  if (lightness < MIN_LIGHTNESS || lightness > MAX_LIGHTNESS) return false
  return saturation >= MIN_SATURATION
}

/**
 * Typeface names, in declaration order.
 *
 * Generic families are dropped: "sans-serif" is a fallback, not a brand choice,
 * and passing it to the model adds nothing. Google Fonts links are read too,
 * since a site loading a webfont names it there even when the CSS is external.
 */
const GENERIC_FAMILIES = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "inherit",
  "initial",
  "unset",
  "revert",
])

export function extractTypography($: CheerioAPI, limit = 5): string[] {
  const names: string[] = []

  const push = (raw: string) => {
    const name = raw.trim().replace(/^["']|["']$/g, "")
    if (!name) return
    const lower = name.toLowerCase()
    if (GENERIC_FAMILIES.has(lower)) return
    if (lower.startsWith("var(") || lower.startsWith("-apple")) return
    if (!names.some((existing) => existing.toLowerCase() === lower)) names.push(name)
  }

  $("style").each((_, element) => {
    const css = $(element).contents().text()
    for (const match of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
      for (const family of match[1].split(",")) push(family)
    }
    // @font-face names the actual brand face even when font-family is aliased.
    for (const match of css.matchAll(/@font-face\s*\{[^}]*font-family\s*:\s*([^;}]+)/gi)) {
      push(match[1])
    }
  })

  // Webfont link hrefs, e.g. fonts.googleapis.com/css2?family=Inter:wght@400
  $('link[href*="fonts.googleapis.com"], link[href*="fonts.bunny.net"]').each((_, element) => {
    const href = $(element).attr("href") ?? ""
    for (const match of href.matchAll(/family=([^:&]+)/g)) {
      push(decodeURIComponent(match[1]).replace(/\+/g, " "))
    }
  })

  return names.slice(0, limit)
}
