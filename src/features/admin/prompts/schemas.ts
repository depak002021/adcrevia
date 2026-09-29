import { z } from "zod"

/**
 * A new version of a prompt.
 *
 * The body's lower bound is deliberately generous and its upper bound is not. A
 * three-word instruction is a legitimate thing to try; a 20,000-character one would
 * dominate every request's token cost and push the actual state out of the context
 * window, which shows up as the model ignoring the brief rather than as an error.
 */
export const promptVersionSchema = z.object({
  label: z.string().trim().min(3).max(120),
  body: z.string().trim().min(20).max(12_000),
  /** Overrides the model for this prompt only. Blank means the application default. */
  model: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value ? value : undefined)),
  temperature: z.number().min(0).max(2).optional(),
  notes: z
    .string()
    .trim()
    .max(1_000)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /**
   * Whether to make this live immediately. Saving without activating is how a wording
   * change gets reviewed before it reaches a user.
   */
  activate: z.boolean().default(false),
})

export type PromptVersionInput = z.infer<typeof promptVersionSchema>
