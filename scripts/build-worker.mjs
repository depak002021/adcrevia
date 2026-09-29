/**
 * Bundle the worker into a single file for the runtime image.
 *
 * `next build --output standalone` only traces the web server, so worker.ts is
 * simply absent from the image. The alternatives were shipping `tsx` plus the
 * TypeScript sources into production, or bundling ahead of time. Bundling wins on
 * a memory-constrained host: one file, no compile step at container start, and no
 * dev tooling in the runtime layer.
 *
 * Native modules stay external. Their `.node` binaries cannot be inlined, and the
 * worker does not need them:
 *   - sharp            image optimisation, web-only
 *   - @node-rs/argon2  password hashing, web-only
 *
 * Prisma 7 with the pg driver adapter is pure JavaScript, so the client and its
 * generated code bundle without a native query engine.
 */

import { build } from "esbuild"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const result = await build({
  entryPoints: [path.join(root, "src/worker.ts")],
  /**
   * `.mjs`, not `.js`. The output is ESM but package.json has no
   * `"type": "module"` (and must not gain one — the postcss, vitest and prisma
   * configs are CJS). Without the explicit extension Node logs
   * MODULE_TYPELESS_PACKAGE_JSON and reparses the whole 8 MB bundle on every
   * container start.
   */
  outfile: path.join(root, "dist/worker.mjs"),
  bundle: true,
  platform: "node",
  // Matches the runtime in the Dockerfile. Keeping this aligned is what allows
  // top-level await in worker.ts.
  target: "node24",
  format: "esm",
  sourcemap: true,
  // Not minified on purpose: a worker stack trace is read by an operator, and
  // the size saving is irrelevant for a server-side bundle.
  minify: false,
  external: ["sharp", "@node-rs/argon2"],
  // esbuild does not read tsconfig `paths` unless pointed at the file.
  tsconfig: path.join(root, "tsconfig.json"),
  /**
   * Some dependencies reference CommonJS globals that do not exist in an ESM
   * bundle. Shimming them here is the documented workaround and avoids falling
   * back to a CJS output, which would rule out top-level await.
   */
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __dirname_fn } from 'node:path';",
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __dirname_fn(__filename);",
    ].join("\n"),
  },
  logLevel: "info",
  metafile: true,
})

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0)
console.log(`worker bundle: ${(bytes / 1024 / 1024).toFixed(2)} MB`)

if (result.warnings.length > 0) {
  console.log(`\n${result.warnings.length} warning(s):`)
  for (const warning of result.warnings) console.log(`  ${warning.text}`)
}
