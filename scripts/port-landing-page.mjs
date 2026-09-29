/**
 * One-shot port of the live landing page into the application.
 *
 * The marketing site was a separate Next.js project with a static export and a PHP
 * waitlist handler. Its components are the real, shipped design — so they are moved
 * rather than reinterpreted, and the only edits are the import paths and the things that
 * genuinely cannot survive the move (the PHP endpoint, and the motion primitives the
 * application already has its own copy of).
 *
 * Kept in the repository as the record of what was moved and what was rewired. Running
 * it again is harmless: it overwrites the same destinations with the same content.
 *
 *   node scripts/port-landing-page.mjs [sourceRoot]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

const SOURCE_ROOT = resolve(process.argv[2] ?? "D:/adcrevia.com")

/** Source path relative to the site's `src`, to destination relative to ours. */
const FILES = [
  ["components/sections/nav.tsx", "components/marketing/sections/nav.tsx"],
  ["components/sections/hero.tsx", "components/marketing/sections/hero.tsx"],
  ["components/sections/platforms.tsx", "components/marketing/sections/platforms.tsx"],
  ["components/sections/thesis.tsx", "components/marketing/sections/thesis.tsx"],
  ["components/sections/workflow.tsx", "components/marketing/sections/workflow.tsx"],
  ["components/sections/automation.tsx", "components/marketing/sections/automation.tsx"],
  ["components/sections/audience.tsx", "components/marketing/sections/audience.tsx"],
  ["components/sections/loop.tsx", "components/marketing/sections/loop.tsx"],
  ["components/sections/founder.tsx", "components/marketing/sections/founder.tsx"],
  ["components/sections/waitlist.tsx", "components/marketing/sections/waitlist.tsx"],
  ["components/sections/footer.tsx", "components/marketing/sections/footer.tsx"],
  ["components/hero/hero-canvas.tsx", "components/marketing/hero/hero-canvas.tsx"],
  ["components/hero/particle-field.ts", "components/marketing/hero/particle-field.ts"],
  ["components/motion/scrub-words.tsx", "components/marketing/motion/scrub-words.tsx"],
  ["components/motion/scroll-refresher.tsx", "components/marketing/motion/scroll-refresher.tsx"],
  ["components/ui/cta.tsx", "components/marketing/ui/cta.tsx"],
  ["components/ui/field.tsx", "components/marketing/ui/field.tsx"],
  ["components/ui/eyebrow.tsx", "components/marketing/ui/eyebrow.tsx"],
  ["lib/content.ts", "features/marketing/content.ts"],
]

/**
 * Import rewrites, longest prefix first so a more specific rule wins.
 *
 * `split-lines` and `reveal` deliberately resolve to the application's copies. They were
 * ported into the design system in an earlier pass and are byte-for-byte the same
 * component; keeping two would mean a motion fix landing in one and not the other.
 *
 * `eyebrow` deliberately does NOT. The marketing one is an accent pill and the
 * application's is a hairline label — same name, different design decision.
 */
const REWRITES = [
  ['@/components/motion/split-lines', '@/components/ui/split-lines'],
  ['@/components/motion/reveal', '@/components/ui/reveal'],
  ['@/components/motion/', '@/components/marketing/motion/'],
  ['@/components/sections/', '@/components/marketing/sections/'],
  ['@/components/hero/', '@/components/marketing/hero/'],
  ['@/components/ui/cta', '@/components/marketing/ui/cta'],
  ['@/components/ui/field', '@/components/marketing/ui/field'],
  ['@/components/ui/eyebrow', '@/components/marketing/ui/eyebrow'],
  ['@/lib/content', '@/features/marketing/content'],
  ['@/lib/waitlist', '@/features/marketing/waitlist'],
]

function rewrite(source) {
  let output = source
  for (const [from, to] of REWRITES) {
    output = output.split(from).join(to)
  }
  return output
}

async function main() {
  let moved = 0

  for (const [from, to] of FILES) {
    const sourcePath = join(SOURCE_ROOT, "src", from)
    const destinationPath = resolve("src", to)

    let contents
    try {
      contents = await readFile(sourcePath, "utf8")
    } catch {
      process.stdout.write(`  skip  ${from} (not found)\n`)
      continue
    }

    await mkdir(dirname(destinationPath), { recursive: true })
    await writeFile(destinationPath, rewrite(contents), "utf8")
    process.stdout.write(`  move  ${from} -> src/${to}\n`)
    moved += 1
  }

  process.stdout.write(`\n${moved}/${FILES.length} files ported\n`)
  process.stdout.write("Not ported, and why:\n")
  process.stdout.write("  lib/waitlist.ts        posts to a PHP file; rewritten by hand\n")
  process.stdout.write("  app/globals.css        tokens already merged into the application\n")
  process.stdout.write("  app/layout.tsx         the application has its own root layout\n")
  process.stdout.write("  motion/reveal.tsx      already in the design system\n")
  process.stdout.write("  motion/split-lines.tsx already in the design system\n")
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
