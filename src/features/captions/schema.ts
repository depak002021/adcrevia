import { z } from "zod"

/**
 * Social copy for one project: what the user pastes under the post.
 *
 * Plain strings in the schema sent to the model (length limits are applied after, in
 * `tidySocialCopy`, so a slightly long line is trimmed rather than failing the call
 * and paying for a retry).
 */
export const socialCopyResponse = z.object({
  hooks: z.array(z.string()).min(1).max(3),
  instagram: z.object({ caption: z.string(), hashtags: z.array(z.string()).max(15) }),
  tiktok: z.object({ caption: z.string(), hashtags: z.array(z.string()).max(6) }),
  youtube: z.object({ title: z.string(), description: z.string(), hashtags: z.array(z.string()).max(5) }),
  meta: z.object({ primaryText: z.string(), headline: z.string(), linkDescription: z.string() }),
})

export type SocialCopyBody = z.infer<typeof socialCopyResponse>

export type SocialCopy = SocialCopyBody & {
  /** What writing it cost, so every call is accounted for. */
  meta_: { model: string; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; writtenAt: string }
}

export type SocialPlatform = "instagram" | "tiktok" | "youtube" | "meta"

function tag(value: string): string | null {
  const cleaned = value.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")
  return cleaned ? `#${cleaned}` : null
}

function tags(values: string[], max: number): string[] {
  // Hashtags are case-insensitive on every platform: #Holi and #holi are one tag.
  const seen = new Set<string>()
  return values
    .map(tag)
    .filter((value): value is string => value !== null && !seen.has(value.toLowerCase()) && Boolean(seen.add(value.toLowerCase())))
    .slice(0, max)
}

function clip(value: string, max: number): string {
  const text = value.trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`
}

/** Normalise what the model returned: clean hashtags, platform length limits. */
export function tidySocialCopy(body: SocialCopyBody): SocialCopyBody {
  return {
    hooks: body.hooks.map((hook) => clip(hook, 140)).filter(Boolean).slice(0, 3),
    instagram: { caption: clip(body.instagram.caption, 2000), hashtags: tags(body.instagram.hashtags, 15) },
    tiktok: { caption: clip(body.tiktok.caption, 300), hashtags: tags(body.tiktok.hashtags, 6) },
    youtube: { title: clip(body.youtube.title, 100), description: clip(body.youtube.description, 1000), hashtags: tags(body.youtube.hashtags, 5) },
    meta: { primaryText: clip(body.meta.primaryText, 500), headline: clip(body.meta.headline, 40), linkDescription: clip(body.meta.linkDescription, 30) },
  }
}

/** The full text to paste for a platform: caption, then its hashtags. */
export function captionFor(copy: SocialCopyBody, platform: SocialPlatform): string {
  if (platform === "instagram") return [copy.instagram.caption, copy.instagram.hashtags.join(" ")].filter(Boolean).join("\n\n")
  if (platform === "tiktok") return [copy.tiktok.caption, copy.tiktok.hashtags.join(" ")].filter(Boolean).join(" ")
  if (platform === "youtube") return [copy.youtube.title, copy.youtube.description, copy.youtube.hashtags.join(" ")].filter(Boolean).join("\n\n")
  return [copy.meta.primaryText, `Headline: ${copy.meta.headline}`, `Description: ${copy.meta.linkDescription}`].join("\n")
}

export function readSocialCopy(value: unknown): SocialCopy | null {
  if (!value || typeof value !== "object") return null
  const parsed = socialCopyResponse.safeParse(value)
  if (!parsed.success) return null
  const meta = (value as { meta_?: SocialCopy["meta_"] }).meta_
  return { ...parsed.data, meta_: meta ?? { model: "unknown", inputTokens: null, outputTokens: null, costUsd: null, writtenAt: new Date(0).toISOString() } }
}
