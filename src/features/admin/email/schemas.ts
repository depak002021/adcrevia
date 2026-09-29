import { z } from "zod"

/**
 * Email delivery as an administrator enters it. Validated strictly at save time for
 * the same reason as storage: a typo here otherwise surfaces as a password reset that
 * never arrives, long after whoever made it has moved on.
 */

const sender = {
  fromName: z
    .string()
    .trim()
    .max(80)
    .regex(/^[^"<>\r\n]*$/, { message: "The sender name cannot contain quotes or angle brackets." })
    .default(""),
  fromAddress: z.string().trim().toLowerCase().email({ message: "Enter the sending email address." }).max(254),
}

const smtpSchema = z.object({
  transport: z.literal("smtp"),
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, {
      message: "Enter the mail server's host name, e.g. mail.example.com.",
    }),
  port: z.coerce.number().int().min(1).max(65535).default(465),
  username: z.string().trim().min(1, { message: "Enter the mailbox login." }).max(254),
  password: z.string().min(1, { message: "Enter the mailbox password." }).max(256),
  ...sender,
})

const resendSchema = z.object({
  transport: z.literal("resend"),
  apiKey: z.string().trim().min(8, { message: "Enter the Resend API key." }).max(256),
  ...sender,
})

export const emailConfigurationSchema = z.discriminatedUnion("transport", [smtpSchema, resendSchema])

export type EmailConfigurationInput = z.infer<typeof emailConfigurationSchema>
