/**
 * Shapes a campaign frame can be generated in, and what each provider needs to
 * produce it. Pure data, shared by the studio form, the job and the adapters.
 *
 * The shape is chosen per project because it decides the video: Kling and Veo
 * image-to-video keep the first frame's shape, so a vertical reel needs vertical
 * frames. Legacy projects (no choice stored) stay 3:2 landscape.
 */

export const IMAGE_FORMATS = ["9:16", "4:5", "1:1", "16:9", "3:2"] as const
export type ImageFormat = (typeof IMAGE_FORMATS)[number]

export const DEFAULT_IMAGE_FORMAT: ImageFormat = "3:2"

export const IMAGE_FORMAT_LABELS: Record<ImageFormat, string> = {
  "9:16": "9:16 · Reels, TikTok, Shorts",
  "4:5": "4:5 · Instagram feed",
  "1:1": "1:1 · Square",
  "16:9": "16:9 · YouTube, web",
  "3:2": "3:2 · Classic landscape",
}

export function asImageFormat(value: unknown): ImageFormat {
  return IMAGE_FORMATS.includes(value as ImageFormat) ? (value as ImageFormat) : DEFAULT_IMAGE_FORMAT
}

/** FLUX.2: multiples of 16, around 2–2.4 MP (well under the 4 MP limit). */
export const FLUX_SIZES: Record<ImageFormat, { width: number; height: number }> = {
  "9:16": { width: 1152, height: 2048 },
  "4:5": { width: 1280, height: 1600 },
  "1:1": { width: 1536, height: 1536 },
  "16:9": { width: 2048, height: 1152 },
  "3:2": { width: 1536, height: 1024 },
}

/** gpt-image models offer three sizes; the nearest orientation is used. */
export const OPENAI_SIZES: Record<ImageFormat, "1024x1536" | "1024x1024" | "1536x1024"> = {
  "9:16": "1024x1536",
  "4:5": "1024x1536",
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "3:2": "1536x1024",
}

/** The video aspect ratio that matches frames of this shape. */
export const VIDEO_ASPECT_FOR_FORMAT: Record<ImageFormat, "9:16" | "4:5" | "1:1" | "16:9"> = {
  "9:16": "9:16",
  "4:5": "4:5",
  "1:1": "1:1",
  "16:9": "16:9",
  "3:2": "16:9",
}
