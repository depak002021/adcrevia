/**
 * Delivery presets.
 *
 * One edit, encoded several times. The alternative — re-cutting per destination —
 * is how the same campaign ends up subtly different on each platform, and it is
 * three times the work for the user.
 *
 * Geometry is deliberately conservative. Every short-form destination accepts
 * 1080x1920 H.264, so the presets that share that shape are kept as separate
 * entries rather than collapsed: per-platform bitrate ceilings and audio handling
 * diverge over time, and a preset per destination means that divergence is a value
 * change rather than a migration.
 */

export type PresetFit = "cover" | "contain"

export type SocialPreset = {
  /** Stable key. Also `CompositionRender.preset`, so it is part of the data. */
  key: string
  label: string
  /** Where it is going, for the share sheet. */
  platform: string
  aspectRatio: string
  width: number
  height: number
  /**
   * Ceiling on the encoded bitrate. CRF drives quality; this stops a high-motion
   * render from producing a file a platform will re-compress hard.
   */
  maxrateKbps: number
  /**
   * Forced framing, when the destination has an opinion. Left unset, framing is
   * chosen from how much of the frame a crop would cost.
   */
  fit?: PresetFit
  hint: string
}

export const SOCIAL_PRESETS: readonly SocialPreset[] = [
  {
    key: "reels",
    label: "Instagram Reels",
    platform: "instagram",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    maxrateKbps: 6_000,
    hint: "Full-screen vertical. Also correct for Facebook Reels.",
  },
  {
    key: "shorts",
    label: "YouTube Shorts",
    platform: "youtube",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    maxrateKbps: 8_000,
    hint: "Vertical, up to 3 minutes.",
  },
  {
    key: "tiktok",
    label: "TikTok",
    platform: "tiktok",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    maxrateKbps: 6_000,
    hint: "Vertical. Keep the lower third clear of the caption overlay.",
  },
  {
    key: "feed_portrait",
    label: "Instagram feed",
    platform: "instagram",
    aspectRatio: "4:5",
    width: 1080,
    height: 1350,
    maxrateKbps: 5_000,
    // 4:5 is the tallest the feed will show; a 9:16 master posted as-is gets
    // centre-cropped by Instagram itself, so cropping deliberately is better than
    // letting the platform choose.
    fit: "cover",
    hint: "The tallest shape the feed will show without cropping it for you.",
  },
  {
    key: "feed_square",
    label: "Square",
    platform: "instagram",
    aspectRatio: "1:1",
    width: 1080,
    height: 1080,
    maxrateKbps: 5_000,
    hint: "Safe everywhere. Useful for paid placements.",
  },
  {
    key: "youtube",
    label: "YouTube / web",
    platform: "youtube",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    maxrateKbps: 12_000,
    // A vertical master cropped to landscape would keep a sliver of the frame.
    // Padding is the only honest option, whatever the area rule says.
    fit: "contain",
    hint: "Landscape, for YouTube, a site hero or an email.",
  },
] as const

/** Master geometries a user can choose to edit in. */
export const MASTER_ASPECTS: readonly { aspectRatio: string; width: number; height: number; label: string }[] = [
  { aspectRatio: "9:16", width: 1080, height: 1920, label: "Vertical" },
  { aspectRatio: "1:1", width: 1080, height: 1080, label: "Square" },
  { aspectRatio: "4:5", width: 1080, height: 1350, label: "Portrait" },
  { aspectRatio: "16:9", width: 1920, height: 1080, label: "Landscape" },
] as const

export function findPreset(key: string): SocialPreset | undefined {
  return SOCIAL_PRESETS.find((preset) => preset.key === key)
}

export function isMasterAspect(aspectRatio: string): boolean {
  return MASTER_ASPECTS.some((entry) => entry.aspectRatio === aspectRatio)
}

export function masterGeometry(aspectRatio: string) {
  return MASTER_ASPECTS.find((entry) => entry.aspectRatio === aspectRatio) ?? MASTER_ASPECTS[0]
}

/**
 * Crop or pad?
 *
 * Cropping looks better when it takes a little off the edges and disastrous when it
 * takes most of the frame — a vertical master cropped to landscape keeps a sliver of
 * the middle and throws the product away. So the decision is made on how much of the
 * frame the crop would cost: up to a third, crop; beyond that, pad.
 *
 * A preset may override this, because some destinations have an opinion regardless
 * of the arithmetic.
 */
export function chooseFit(
  master: { width: number; height: number },
  target: { width: number; height: number; fit?: PresetFit },
): PresetFit {
  if (target.fit) return target.fit

  const masterAspect = master.width / master.height
  const targetAspect = target.width / target.height
  if (!Number.isFinite(masterAspect) || !Number.isFinite(targetAspect)) return "contain"

  // Fraction of the master frame that survives a centre crop to the target shape.
  const kept = targetAspect > masterAspect ? masterAspect / targetAspect : targetAspect / masterAspect
  return kept >= 0.67 ? "cover" : "contain"
}
