import { z } from "zod"

export const creativeDirectionSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().min(20).max(500),
  environment: z.string().trim().min(2).max(500),
  lighting: z.string().trim().min(2).max(500),
  composition: z.string().trim().min(2).max(500),
  cameraDirection: z.string().trim().min(2).max(500),
  mood: z.string().trim().min(2).max(300),
  colorTreatment: z.string().trim().min(2).max(500),
  imagePrompt: z.string().trim().min(30).max(4000),
})

export function creativeDirectionsResponseSchema(count: number) {
  return z.object({ directions: z.array(creativeDirectionSchema).length(count) })
}

export type CreativeDirectionInput = z.infer<typeof creativeDirectionSchema>
