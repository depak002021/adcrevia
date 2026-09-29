import { z } from "zod"

import { waitlist } from "./content"

/**
 * Waitlist validation.
 *
 * Ported from the static marketing site, where the same schema ran in the browser and
 * was mirrored by hand in `public/api/waitlist.php`. Two copies of a validation contract
 * is exactly how they drift, so the PHP half is gone: the browser and the route handler
 * now import this module, and there is one place to change a rule.
 *
 * Client-side validation stays, because it is what focuses the offending field and saves
 * a round trip. The route handler is the half that is trusted.
 */

const URL_SHAPE = /^https?:\/\/[^\s.]+\.[^\s]{2,}$/i
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const waitlistSchema = z.object({
  name: z.string().trim().min(2, "Tell us what to call you.").max(80, "That is longer than we can store."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(160, "That is longer than we can store.")
    // A shape check rather than `z.email()`: the addresses that matter here are typed by
    // hand on a phone, and the useful rejection is "you left the domain off", not RFC
    // conformance.
    .regex(EMAIL_SHAPE, "That does not look like an email address."),
  sells: z.string().trim().min(3, "A few words is enough.").max(240, "Keep it under 240 characters."),
  businessType: z
    .string()
    .refine((value) => (waitlist.businessTypes as readonly string[]).includes(value), "Pick the closest option."),
  website: z
    .string()
    .trim()
    .max(200, "That is longer than we can store.")
    .optional()
    .refine((value) => !value || URL_SHAPE.test(value), "Include the full address, starting with https://"),
  source: z
    .string()
    .trim()
    .max(60)
    .optional()
    .refine((value) => !value || (waitlist.sources as readonly string[]).includes(value), "Pick the closest option."),
})

/**
 * Name of the hidden decoy input.
 *
 * Kept out of the schema on purpose: if it were a validated field, a browser autofilling
 * it would hand a real visitor a validation error with no visible cause. It is checked
 * before parsing instead.
 */
export const honeypotField = "nickname"

export type WaitlistInput = z.infer<typeof waitlistSchema>

/** Field order used to focus the first problem after a failed submit. */
export const waitlistFieldOrder = ["name", "email", "sells", "businessType", "source", "website"] as const

/**
 * Where the form posts.
 *
 * A route handler in this application now, not the PHP file that shipped beside the
 * static export. That is the whole point of the merge: a signup becomes a row with the
 * same validation contract as everything else, so the rollout can be planned from real
 * data instead of a mailbox.
 */
export const waitlistEndpoint = "/api/waitlist"

export function firstFieldErrors(error: z.ZodError<unknown>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form")
    if (!errors[field]) errors[field] = issue.message
  }
  return errors
}
