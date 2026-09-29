import { Prisma } from "@/generated/prisma/client"
import { getPrisma } from "@/lib/db/prisma"

import { waitlistSchema, type WaitlistInput } from "./waitlist"

/**
 * Recording a waitlist signup.
 *
 * The static site posted to a PHP script that appended to a CSV beside the export.
 * Making it a row is what turns "we have some signups" into a rollout that can be
 * planned: who sells what, which batch they belong to, and whether they have been
 * invited yet.
 */

export type SignupResult =
  | { ok: true; created: boolean }
  | { ok: false; fieldErrors: Record<string, string> }

/**
 * Idempotent on email.
 *
 * A second submit with the same address updates the answers rather than failing. Someone
 * correcting a typo in what they sell should not be told they are already on the list and
 * left with the wrong answer stored — and the unique index means the alternative is a
 * 500.
 */
export async function recordWaitlistSignup(raw: unknown): Promise<SignupResult> {
  const parsed = waitlistSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form")
      if (!fieldErrors[field]) fieldErrors[field] = issue.message
    }
    return { ok: false, fieldErrors }
  }

  const data = toRow(parsed.data)

  try {
    const existing = await getPrisma().waitlistSignup.findUnique({
      where: { email: data.email },
      select: { id: true },
    })

    if (existing) {
      await getPrisma().waitlistSignup.update({ where: { id: existing.id }, data })
      return { ok: true, created: false }
    }

    await getPrisma().waitlistSignup.create({ data })
    return { ok: true, created: true }
  } catch (error) {
    // Two submits landing together: the unique index arbitrates and the loser treats it
    // as the success it effectively is.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: true, created: false }
    }
    throw error
  }
}

function toRow(input: WaitlistInput) {
  return {
    name: input.name,
    email: input.email,
    sells: input.sells,
    businessType: input.businessType,
    // Stored as null rather than an empty string, so "not supplied" is distinguishable
    // from "supplied as blank" in a query.
    website: input.website?.length ? input.website : null,
    source: input.source?.length ? input.source : null,
  }
}

/** Signups for the admin console, newest first. */
export function listWaitlistSignups(take = 200) {
  return getPrisma().waitlistSignup.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 500),
    select: {
      id: true,
      name: true,
      email: true,
      sells: true,
      businessType: true,
      website: true,
      source: true,
      invitedAt: true,
      createdAt: true,
    },
  })
}
