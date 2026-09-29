import { z } from "zod"

export const generationPolicySchema = z.object({
  defaultImageCount: z.number().int().min(1).max(10),
})

export type GenerationPolicy = z.infer<typeof generationPolicySchema>
