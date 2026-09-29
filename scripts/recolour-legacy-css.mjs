/**
 * One-shot migration helper: move the recovered legacy stylesheet off the old
 * violet/cyan brand and onto the citron accent used by the live marketing site.
 *
 * Why this exists
 * ---------------
 * The previous globals.css hardcoded roughly 170 distinct violet and blue
 * values, and Tailwind's minifier had already collapsed every `rgba(139,92,246,
 * 0.08)` into `#8b5cf614`, scattering near-identical shades everywhere. Hand
 * editing that many literals is slower and less reliable than colour maths.
 *
 * What it does, and deliberately does not do
 * ------------------------------------------
 * Low-alpha blue/violet values are glows, hairlines and tinted panels. Over a
 * near-black page those read purely as "an accent is present", so rotating them
 * onto the citron hue at the same alpha is safe and fully automatic.
 *
 * Solid or near-solid blue/violet values are a different problem. The old
 * accent was mid-dark, so it carried WHITE text; citron is light and needs DARK
 * text. A hue rotation there would produce unreadable buttons. Those are left
 * untouched and reported instead, so they can be redesigned by hand.
 *
 * Greens, yellows and reds are semantic state colours and are never touched.
 * Neutrals (saturation under 10%) are never touched.
 *
 * Usage: node scripts/recolour-legacy-css.mjs <in> <out>
 */

import { readFile, writeFile } from "node:fs/promises"

/** Hue of the citron accent (#d8f651). Every remapped tint lands here. */
const ACCENT_HUE = 72
/** Blue through violet, inclusive. The old brand lived in this band. */
const COLD_HUE_MIN = 195
const COLD_HUE_MAX = 300
/** Above this alpha a colour is load-bearing, not a tint. */
const TINT_ALPHA_CEILING = 0.45
/** Below this saturation a colour is neutral and must be preserved exactly. */
const NEUTRAL_SATURATION = 0.1

function parseHex(hex) {
  const raw = hex.slice(1)
  const expand = (s) => s.split("").map((c) => c + c).join("")
  let body
  let alpha = 1
  if (raw.length === 3) body = expand(raw)
  else if (raw.length === 4) {
    body = expand(raw.slice(0, 3))
    alpha = parseInt(expand(raw.slice(3)), 16) / 255
  } else if (raw.length === 6) body = raw
  else if (raw.length === 8) {
    body = raw.slice(0, 6)
    alpha = parseInt(raw.slice(6), 16) / 255
  } else return null
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
    alpha,
    hadAlpha: raw.length === 4 || raw.length === 8,
  }
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x]
  const m = l - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

const toHex = (n) => n.toString(16).padStart(2, "0")

function formatHex({ r, g, b }, alpha, hadAlpha) {
  const base = `#${toHex(r)}${toHex(g)}${toHex(b)}`
  if (!hadAlpha) return base
  return `${base}${toHex(Math.round(alpha * 255))}`
}

/**
 * Explicit mapping for the load-bearing cold colours the automatic pass refuses
 * to touch. Grouped by the ROLE each value played in the old stylesheet, which
 * is what determines the correct replacement:
 *
 *   surface  -> the ink elevation scale. These were near-black already, just
 *               with a blue-purple cast, so they only need neutralising.
 *   text     -> fg / muted / faint. Lavender-tinted body copy becomes neutral.
 *   accent   -> the citron family. Used for icons, borders and emphasis where
 *               the colour sits ON a dark background, so a light accent is a
 *               straight improvement in contrast.
 *
 * Solid accent FILLS that carried white text are not listed here. They are
 * overridden by hand in the appended compatibility block, because swapping the
 * fill to citron also requires flipping the text to ink.
 */
const MANUAL_MAP = {
  // -- surfaces ------------------------------------------------------------
  "#090a0f": "#07080a",
  "#0b0c11": "#0b0d11",
  "#0c0d13": "#0b0d11",
  "#0d0e14": "#0b0d11",
  "#0f111b": "#101319",
  "#151620": "#101319",
  "#171722": "#171b22",
  "#171823": "#171b22",
  "#191522": "#171b22",
  "#20212b": "#1f242d",
  "#07070ac2": "#07080ac2",
  "#0a0a0fd1": "#07080ad1",
  "#05060ab8": "#07080ab8",
  "#0c0c13db": "#0b0d11db",
  "#0c0d13eb": "#0b0d11eb",
  "#0c0d12f5": "#0b0d11f5",
  "#16171ff0": "#171b22f0",
  "#2e167280": "#171b2280",
  // -- text ----------------------------------------------------------------
  "#f3e9ff": "#f3f4f6",
  "#efedf7": "#f3f4f6",
  "#e7e5ef": "#f3f4f6",
  "#ddd8ef": "#e6e8eb",
  "#d8d4e7": "#e6e8eb",
  "#d9d7e1": "#e6e8eb",
  "#9b97aa": "#9ba2ad",
  "#8e87a0": "#7f8792",
  // -- accent: light lavenders became accent text/icon tints ---------------
  "#c6b5ff": "#e8fa9a",
  "#c7b5ff": "#e8fa9a",
  "#baaaff": "#e2f78a",
  "#c4b8ff": "#e2f78a",
  "#b7a6ff": "#dcf578",
  "#b5a4ff": "#dcf578",
  "#b5a6fa": "#dcf578",
  "#ae9cff": "#d8f651",
  "#ab98ff": "#d8f651",
  "#aa95ff": "#d8f651",
  "#aa97ff": "#d8f651",
  "#aa98ff": "#d8f651",
  "#a997ff": "#d8f651",
  "#a991ff": "#d8f651",
  "#a68fff": "#d8f651",
  "#a590ff": "#d8f651",
  "#a58fff": "#d8f651",
  "#a38fff8c": "#d8f6518c",
  "#9a85ff": "#cbe94a",
  "#9881ff": "#cbe94a",
  "#a978ff": "#cbe94a",
  "#a36dff": "#cbe94a",
  // -- accent: mid violets became the deeper accent stop -------------------
  "#8061ff": "#a9c93b",
  "#8064ff": "#a9c93b",
  "#8265ff": "#a9c93b",
  "#7958ff": "#a9c93b",
  "#7362d4": "#94b234",
  "#6358e9": "#94b234",
  "#5f54e8": "#94b234",
  "#6440e8c2": "#94b234c2",
  "#8462ff73": "#a9c93b73",
  "#7f5df48c": "#a9c93b8c",
  "#8b5cf673": "#d8f65173",
  "#8b5cf680": "#d8f65180",
  "#8b5cf699": "#d8f65199",
  "#8b5cf6b3": "#d8f651b3",
  "#8b5cf6bf": "#d8f651bf",
  "#8b5cf6e6": "#d8f651e6",
  "#8b5cf6f2": "#d8f651f2",
  // -- the old secondary accent (electric blue) collapses into the one accent
  "#399fee": "#a9c93b",
  "#3398ef": "#a9c93b",
  "#4ba9ff": "#cbe94a",
  "#65bfff": "#e2f78a",
}

const [, , inputPath, outputPath] = process.argv
if (!inputPath || !outputPath) {
  console.error("usage: node scripts/recolour-legacy-css.mjs <in> <out>")
  process.exit(1)
}

const source = await readFile(inputPath, "utf8")

const remapped = new Map()
const preservedSolids = new Map()

const result = source.replace(/#[0-9a-fA-F]{3,8}\b/g, (match) => {
  const lower = match.toLowerCase()

  // An explicit role mapping always wins over the automatic hue rotation.
  if (MANUAL_MAP[lower]) {
    remapped.set(lower, MANUAL_MAP[lower])
    return MANUAL_MAP[lower]
  }

  const parsed = parseHex(match)
  if (!parsed) return match

  const hsl = rgbToHsl(parsed)
  if (hsl.s < NEUTRAL_SATURATION) return match
  if (hsl.h < COLD_HUE_MIN || hsl.h > COLD_HUE_MAX) return match

  if (parsed.alpha > TINT_ALPHA_CEILING) {
    // Load-bearing colour with no explicit mapping. Report it rather than
    // guessing, because a hue rotation here can break text contrast.
    preservedSolids.set(lower, (preservedSolids.get(lower) ?? 0) + 1)
    return match
  }

  const rotated = hslToRgb({ h: ACCENT_HUE, s: hsl.s, l: hsl.l })
  const next = formatHex(rotated, parsed.alpha, parsed.hadAlpha)
  remapped.set(match.toLowerCase(), next)
  return next
})

await writeFile(outputPath, result, "utf8")

console.log(`remapped ${remapped.size} distinct cold tints onto the citron hue`)
console.log(
  `left ${preservedSolids.size} load-bearing cold colours for manual redesign:`,
)
for (const [value, count] of [...preservedSolids].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${value}  x${count}`)
}
