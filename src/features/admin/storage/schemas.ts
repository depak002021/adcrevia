import { z } from "zod"

/**
 * Storage configuration as an administrator enters it.
 *
 * The URL fields are validated as URLs rather than as strings because a typo here does
 * not fail at save time — it fails on the first upload after the next generation, by
 * which point the person who made the typo has moved on.
 */
export const storageConfigurationSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .url()
    .max(512)
    .refine((value) => value.startsWith("https://"), { message: "The endpoint must be https." }),
  accessKeyId: z.string().trim().min(8).max(256),
  secretAccessKey: z.string().trim().min(8).max(512),
  bucket: z
    .string()
    .trim()
    .min(3)
    .max(63)
    // S3 bucket naming: lowercase letters, digits, hyphens and dots, starting and
    // ending alphanumeric. An invalid name produces a signature error that reads as an
    // authentication failure, which sends the operator looking in the wrong place.
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { message: "That is not a valid bucket name." }),
  publicBaseUrl: z
    .string()
    .trim()
    .url()
    .max(512)
    .refine((value) => value.startsWith("https://"), { message: "The public URL must be https." })
    // The S3 API host is private: browsers and AI providers get HTTP 400 from it, so
    // every image and video would appear broken. It is the most common mistake here.
    .refine((value) => !/\.r2\.cloudflarestorage\.com$/i.test(safeHost(value)), {
      message:
        "That is the private S3 API address. Use the bucket's public URL: in Cloudflare R2 → your bucket → Settings → Public access, enable the r2.dev URL (https://pub-….r2.dev) or connect a custom domain.",
    }),
})

function safeHost(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return ""
  }
}

export type StorageConfigurationInput = z.infer<typeof storageConfigurationSchema>
