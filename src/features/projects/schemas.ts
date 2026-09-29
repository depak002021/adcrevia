import { z } from "zod"

const hexColor = z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).transform((value) => {
  const hex = value.slice(1).toUpperCase()
  return `#${hex.length === 3 ? [...hex].map((part) => `${part}${part}`).join("") : hex}`
})

export const projectInputSchema = z.object({
  prompt: z.string().trim().min(12).max(4000),
  websiteUrl: z.string().trim().url().max(2048).optional().or(z.literal("")),
  brandPalette: z.array(hexColor).max(8).default([]).transform((colors) => [...new Set(colors)]),
})

export type ProjectInput = z.infer<typeof projectInputSchema>
