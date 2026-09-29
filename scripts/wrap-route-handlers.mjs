/**
 * One-shot codemod: wrap every App Router handler in `route()` so a thrown
 * `HttpError` from an auth guard becomes a real 401/403 instead of an unhandled
 * 500. See src/lib/http/route.ts for why.
 *
 * Transformation, per handler:
 *
 *   export async function GET(request: Request) { ... }
 *   ->
 *   async function GETHandler(request: Request) { ... }
 *   ...
 *   export const GET = route(GETHandler)
 *
 * Renaming and re-exporting rather than wrapping in place is deliberate: it
 * never has to locate the handler's closing brace, which is where a regex
 * codemod would get this wrong.
 *
 * NextAuth's catch-all route is untouched — it exports handlers produced by the
 * library, not function declarations, so the pattern does not match it.
 *
 * Usage: node scripts/wrap-route-handlers.mjs [--check]
 */

import { readFile, writeFile } from "node:fs/promises"
import { glob } from "node:fs/promises"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]
const checkOnly = process.argv.includes("--check")

const files = []
for await (const entry of glob("src/app/api/**/route.ts")) files.push(entry)
files.sort()

let changed = 0
const skipped = []

for (const file of files) {
  const original = await readFile(file, "utf8")
  let source = original
  const wrapped = []

  for (const method of METHODS) {
    const declaration = new RegExp(`^export async function ${method}\\s*\\(`, "m")
    if (!declaration.test(source)) continue
    source = source.replace(declaration, `async function ${method}Handler(`)
    wrapped.push(method)
  }

  if (wrapped.length === 0) {
    skipped.push(file)
    continue
  }

  // Add the import directly after the final existing import statement, so the
  // grouping convention in each file is preserved.
  if (!source.includes('from "@/lib/http/route"')) {
    const imports = [...source.matchAll(/^import .*?$/gms)]
    const last = imports.at(-1)
    if (last) {
      const at = last.index + last[0].length
      source = `${source.slice(0, at)}\nimport { route } from "@/lib/http/route"${source.slice(at)}`
    } else {
      source = `import { route } from "@/lib/http/route"\n\n${source}`
    }
  }

  const exports = wrapped.map((method) => `export const ${method} = route(${method}Handler)`).join("\n")
  source = `${source.trimEnd()}\n\n${exports}\n`

  if (source !== original) {
    changed += 1
    if (!checkOnly) await writeFile(file, source, "utf8")
    console.log(`${checkOnly ? "would wrap" : "wrapped"} ${wrapped.join(", ").padEnd(18)} ${file}`)
  }
}

console.log(`\n${changed} file(s) ${checkOnly ? "would be" : ""} changed, ${skipped.length} skipped`)
for (const file of skipped) console.log(`  skipped (no plain handler declarations): ${file}`)
