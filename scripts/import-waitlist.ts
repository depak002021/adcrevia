import "dotenv/config"

import { readFile } from "node:fs/promises"

import { getPrisma } from "../src/lib/db/prisma"
import { waitlistSchema } from "../src/features/marketing/waitlist"

/**
 * One-off import of the signups collected by the static site's PHP handler.
 *
 * Before the landing page moved into the application, `public/api/waitlist.php` appended
 * each signup to `adcrevia-data/waitlist.jsonl` beside `public_html` on the old host. Those
 * people are on the list and must not be lost at cutover, so this reads that file into
 * `WaitlistSignup`.
 *
 *   pnpm waitlist:import path/to/waitlist.jsonl            (dry run: reports only)
 *   pnpm waitlist:import path/to/waitlist.jsonl --apply    (writes)
 *
 * Rules, chosen so it is safe to run more than once and safe to run after the new form
 * has started taking signups:
 *
 *  - Every line is validated with the same schema the live form uses. A line that fails
 *    is reported with its line number and reason and is NOT written; nothing is guessed.
 *  - Several lines for one email (someone signing up twice) collapse to one row: the
 *    answers from the most recent line, the date from the earliest, so their place in
 *    the queue is kept.
 *  - An email already in the database is left exactly as it is. A row there is either
 *    from a previous import or from the new form, and in both cases it is at least as
 *    current as this file.
 *  - The PHP handler also stored the visitor's IP address and user agent. Those are
 *    deliberately not carried over: the new table has no place for them and the footer
 *    promises to store only what the form asks for.
 */

type Parsed = { line: number; createdAt: Date; data: ReturnType<typeof waitlistSchema.parse> }

async function main() {
  const [path, ...flags] = process.argv.slice(2)
  const apply = flags.includes("--apply")
  if (!path) {
    process.stderr.write("usage: pnpm waitlist:import <waitlist.jsonl> [--apply]\n")
    process.exitCode = 2
    return
  }

  const lines = (await readFile(path, "utf8")).split(/\r?\n/)
  const accepted: Parsed[] = []
  const rejected: { line: number; reason: string }[] = []

  lines.forEach((text, index) => {
    const line = index + 1
    if (!text.trim()) return

    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(text) as Record<string, unknown>
    } catch {
      rejected.push({ line, reason: "not valid JSON" })
      return
    }

    const parsed = waitlistSchema.safeParse({
      name: raw.name,
      email: raw.email,
      sells: raw.sells,
      businessType: raw.businessType,
      // The PHP handler stored "" for an unanswered optional field.
      website: raw.website || undefined,
      source: raw.source || undefined,
    })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      rejected.push({ line, reason: `${String(issue?.path[0] ?? "entry")}: ${issue?.message ?? "invalid"}` })
      return
    }

    const createdAt = new Date(typeof raw.createdAt === "string" ? raw.createdAt : Number.NaN)
    if (Number.isNaN(createdAt.getTime())) {
      rejected.push({ line, reason: "createdAt: missing or not a date" })
      return
    }

    accepted.push({ line, createdAt, data: parsed.data })
  })

  // Collapse repeats: latest answers, earliest date.
  const byEmail = new Map<string, { first: Date; latest: Parsed }>()
  for (const entry of accepted) {
    const current = byEmail.get(entry.data.email)
    if (!current) {
      byEmail.set(entry.data.email, { first: entry.createdAt, latest: entry })
      continue
    }
    if (entry.createdAt < current.first) current.first = entry.createdAt
    if (entry.createdAt >= current.latest.createdAt) current.latest = entry
  }

  const prisma = getPrisma()
  const existing = new Set(
    (
      await prisma.waitlistSignup.findMany({
        where: { email: { in: [...byEmail.keys()] } },
        select: { email: true },
      })
    ).map((row) => row.email),
  )

  const toCreate = [...byEmail.entries()].filter(([email]) => !existing.has(email))

  process.stdout.write(
    [
      `lines read            ${lines.filter((text) => text.trim()).length}`,
      `valid entries         ${accepted.length}`,
      `distinct emails       ${byEmail.size}`,
      `already in database   ${existing.size} (left untouched)`,
      `${apply ? "imported" : "would import"}          ${toCreate.length}`,
      `rejected lines        ${rejected.length}`,
      "",
    ].join("\n"),
  )
  for (const { line, reason } of rejected) process.stdout.write(`  line ${line}: ${reason}\n`)

  if (apply && toCreate.length > 0) {
    await prisma.waitlistSignup.createMany({
      data: toCreate.map(([, { first, latest }]) => ({
        name: latest.data.name,
        email: latest.data.email,
        sells: latest.data.sells,
        businessType: latest.data.businessType,
        website: latest.data.website?.length ? latest.data.website : null,
        source: latest.data.source?.length ? latest.data.source : null,
        createdAt: first,
      })),
      // A signup landing through the new form between the read above and this write
      // must win, not fail the whole import.
      skipDuplicates: true,
    })
  }

  if (!apply) process.stdout.write("\nDry run. Nothing was written. Re-run with --apply to import.\n")
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Waitlist import failed")
  process.exitCode = 1
})
