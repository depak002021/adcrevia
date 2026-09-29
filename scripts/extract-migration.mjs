/**
 * Assemble the 0005 migration from Prisma's own full DDL output.
 *
 * `prisma migrate diff --from-migrations` needs a shadow database to replay the
 * existing migrations against, and there is no Postgres available on this
 * machine. Generating the complete schema DDL and lifting out only the new
 * objects gives the same SQL Prisma would have produced, with Prisma's exact
 * type mapping and constraint naming, without inventing any of it by hand.
 *
 * Usage: node scripts/extract-migration.mjs <full-ddl.sql> <out.sql>
 */

import { readFile, writeFile } from "node:fs/promises"

/** Objects introduced by this migration. */
const NEW_ENUMS = [
  "JobStatus",
  "JobKind",
  "MessageRole",
  "ConversationPhase",
  "DecisionKind",
  "CompositionStatus",
  "ClipTransition",
  "AudioTrackKind",
]

const NEW_TABLES = [
  "Job",
  "Conversation",
  "Message",
  "AgentRun",
  "Decision",
  "VideoComposition",
  "CompositionClip",
  "CompositionRender",
  "AudioTrack",
  "PromptTemplate",
  "WaitlistSignup",
]

const [, , inputPath, outputPath] = process.argv
if (!inputPath || !outputPath) {
  console.error("usage: node scripts/extract-migration.mjs <full-ddl.sql> <out.sql>")
  process.exit(1)
}

const ddl = await readFile(inputPath, "utf8")

// Prisma emits one statement per block, separated by blank lines, each preceded
// by a `-- Comment` line. Splitting on the semicolon keeps statements intact.
const statements = ddl
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => `${s};`)

const quoted = (names) => names.map((n) => `"${n}"`)
const enumNames = new Set(quoted(NEW_ENUMS))
const tableNames = new Set(quoted(NEW_TABLES))

/** Which of the new objects a statement belongs to, or null to skip it. */
function classify(statement) {
  const createEnum = statement.match(/CREATE TYPE ("[^"]+")/)
  if (createEnum) return enumNames.has(createEnum[1]) ? "enum" : null

  const createTable = statement.match(/CREATE TABLE ("[^"]+")/)
  if (createTable) return tableNames.has(createTable[1]) ? "table" : null

  const createIndex = statement.match(/CREATE (?:UNIQUE )?INDEX .*? ON ("[^"]+")/s)
  if (createIndex) return tableNames.has(createIndex[1]) ? "index" : null

  const alter = statement.match(/ALTER TABLE ("[^"]+")/)
  if (alter) {
    // Foreign keys on the new tables, plus foreign keys FROM existing tables
    // that now point at a new table.
    if (tableNames.has(alter[1])) return "fk"
    const references = statement.match(/REFERENCES ("[^"]+")/)
    if (references && tableNames.has(references[1])) return "fk"
    return null
  }

  return null
}

const buckets = { enum: [], table: [], index: [], fk: [] }
for (const statement of statements) {
  const bucket = classify(statement)
  if (bucket) buckets[bucket].push(statement)
}

const header = `-- Durable job queue, agentic brief, video composition, versioned prompts and waitlist.
--
-- Assembled from Prisma's own DDL output (see scripts/extract-migration.mjs) and
-- extended with two things Prisma cannot express in the schema language:
--   * the additive ALTERs for ImageEvaluation.recommended and
--     APIConfiguration.settings, which are new columns on existing tables
--   * a PARTIAL unique index guaranteeing at most one active PromptTemplate per
--     key, which is the invariant that makes rollback safe
--
-- Every statement is additive. No existing column is dropped or retyped, so this
-- applies to a populated database without data loss.
`

const sections = [
  ["-- Enums", buckets.enum],
  ["-- New tables", buckets.table],
  ["-- Indexes", buckets.index],
  ["-- Foreign keys", buckets.fk],
]

const manual = `
-- Additive columns on existing tables.
-- ImageEvaluation.recommended was previously computed in memory on every request
-- and recomputed again client-side, so nothing recorded which frame had actually
-- been recommended.
ALTER TABLE "ImageEvaluation" ADD COLUMN "recommended" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "ImageEvaluation_recommended_idx" ON "ImageEvaluation"("recommended");

-- Non-secret provider configuration that still belongs beside the credential,
-- readable in the admin console without decryption.
ALTER TABLE "APIConfiguration" ADD COLUMN "settings" JSONB;

-- At most one active version per prompt key. Prisma's schema language has no
-- partial unique index, so activating a version has to be safe at the database
-- level rather than relying on application code to deactivate the previous one
-- first.
CREATE UNIQUE INDEX "PromptTemplate_key_active_unique"
  ON "PromptTemplate"("key")
  WHERE "active";
`

const output = [
  header,
  ...sections.flatMap(([title, list]) => (list.length ? [title, list.join("\n\n")] : [])),
  manual,
].join("\n\n")

await writeFile(outputPath, `${output.trim()}\n`, "utf8")

console.log(`enums:   ${buckets.enum.length}`)
console.log(`tables:  ${buckets.table.length}`)
console.log(`indexes: ${buckets.index.length}`)
console.log(`fks:     ${buckets.fk.length}`)
console.log(`written: ${outputPath}`)
