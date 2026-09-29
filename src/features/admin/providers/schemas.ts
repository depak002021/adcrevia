import { z } from "zod"

export const providerConfigurationSchema = z.object({
  kind: z.enum(["IMAGE", "VIDEO"]),
  provider: z.enum(["OPENAI", "RUNWAY"]),
  model: z.string().trim().min(1).max(100),
  endpoint: z.string().url().max(500).optional().or(z.literal("")),
  apiKey: z.string().min(16).max(500),
  enabled: z.boolean().default(true),
}).superRefine((value, context) => {
  if ((value.provider === "OPENAI" && value.kind !== "IMAGE") || (value.provider === "RUNWAY" && value.kind !== "VIDEO")) {
    context.addIssue({ code: "custom", path: ["provider"], message: "Provider does not support this kind." })
  }
})

export const bflConfigurationSchema = z.object({
  apiKey: z.string().min(16).max(500),
  imageModel: z.string().trim().regex(/^[a-z0-9.-]+$/).max(100).default("flux-2-pro"),
  videoModel: z.string().trim().regex(/^[a-z0-9.-]+$/).max(100).default("flux-3-video"),
  imageEnabled: z.boolean(),
  videoEnabled: z.boolean(),
})

export type ProviderConfigurationInput = z.infer<typeof providerConfigurationSchema>
export type BflConfigurationInput = z.infer<typeof bflConfigurationSchema>
