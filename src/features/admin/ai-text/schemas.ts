import { z } from "zod"

/**
 * An OpenAI model id as an administrator types it. Empty means "not set here": the
 * environment variable, then the default, applies again. The character set is what
 * model ids actually use, so a pasted sentence or a stray quote fails at save time
 * instead of on the next generation.
 */
const modelName = z
  .string()
  .trim()
  .max(100)
  .regex(/^[A-Za-z0-9._:-]*$/, { message: "Use the model id exactly, e.g. gpt-5-mini." })

export const textModelsSchema = z.object({
  text: modelName.default(""),
  agent: modelName.default(""),
  decision: modelName.default(""),
})

export const typeSafeConfigurationSchema = z.object({
  apiKey: z.string().trim().min(8).max(512),
  model: modelName.default(""),
  endpoint: z
    .string()
    .trim()
    .max(512)
    .refine((value) => value === "" || /^https:\/\/[^\s]+$/.test(value), {
      message: "The endpoint must be an https URL.",
    })
    .default(""),
})

export type TextModelsInput = z.infer<typeof textModelsSchema>
export type TypeSafeConfigurationInput = z.infer<typeof typeSafeConfigurationSchema>
