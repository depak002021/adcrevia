/**
 * Plan a reel longer than one render: how many clips, how long each, and which
 * storyboard frames each one uses. Pure, so the form shows exactly the plan (and cost)
 * the server will execute.
 *
 * Clips overlap by the transition (a crossfade shows both clips at once), so the
 * finished length is sum(clips) − (clips − 1) × overlap. The planner uses as few clips
 * as possible (fewer cuts, fewer paid calls), each as long as the model allows, then
 * shortens clips only while the reel still reaches the target.
 */

export const REEL_TRANSITIONS = ["CROSSFADE", "DISSOLVE", "FADE_BLACK", "NONE"] as const
export type ReelTransition = (typeof REEL_TRANSITIONS)[number]

export const REEL_TRANSITION_LABELS: Record<ReelTransition, string> = {
  CROSSFADE: "Crossfade",
  DISSOLVE: "Dissolve",
  FADE_BLACK: "Fade through black",
  NONE: "Hard cut",
}

/** Transition length between clips; a hard cut does not overlap. */
export const REEL_TRANSITION_MS = 500
/** Lengths offered beyond a model's single-render maximum. */
export const REEL_LENGTHS = [15, 20, 30] as const
/** More clips than this means more cuts than a 30 s ad can carry. */
export const MAX_REEL_CLIPS = 6

export type ReelClipPlan = {
  index: number
  seconds: number
  /** Storyboard frame positions (0-based) this clip opens with and, if supported, closes on. */
  firstScene: number
  lastScene: number | null
}

export type ReelPlan = { clips: ReelClipPlan[]; totalSeconds: number }

export function planReel(input: {
  targetSeconds: number
  /** Exact lengths the chosen model accepts, ascending. */
  durations: number[]
  sceneCount: number
  /** The model can end a clip on a given frame (Kling 3.0, Veo). */
  lastFrame: boolean
  transition: ReelTransition
}): ReelPlan | null {
  const durations = [...input.durations].sort((a, b) => a - b)
  const max = durations[durations.length - 1]
  if (!max || input.targetSeconds <= max || input.sceneCount < 1) return null
  const overlap = input.transition === "NONE" ? 0 : REEL_TRANSITION_MS / 1000

  // Fewest clips that can reach the target at full length.
  let count = 2
  while (count * max - (count - 1) * overlap < input.targetSeconds) count += 1
  if (count > MAX_REEL_CLIPS) return null

  const seconds = Array.from({ length: count }, () => max)
  const total = () => seconds.reduce((sum, value) => sum + value, 0) - (count - 1) * overlap
  // Shorten clips (from the last) one allowed step at a time while still on target.
  for (let changed = true; changed; ) {
    changed = false
    for (let clip = count - 1; clip >= 0; clip -= 1) {
      const lower = durations.filter((value) => value < seconds[clip]).pop()
      if (lower === undefined) continue
      if (total() - (seconds[clip] - lower) >= input.targetSeconds) {
        seconds[clip] = lower
        changed = true
      }
    }
  }

  // Walk the storyboard: clip k opens on scene k and, where the model allows, closes
  // on scene k+1 — which is exactly where clip k+1 opens, so the cut is seamless.
  const scenes = input.sceneCount
  const clips = seconds.map((value, index) => ({
    index,
    seconds: value,
    firstScene: index % scenes,
    lastScene: input.lastFrame && scenes > 1 ? (index + 1) % scenes : null,
  }))
  return { clips, totalSeconds: Math.round(total() * 10) / 10 }
}

/** The part of the brief each clip plays, so the joined reel reads as one ad. */
export function shotDirection(index: number, count: number): string {
  if (index === 0) return `Shot 1 of ${count}: open with a strong hook in the first second and introduce the product.`
  if (index === count - 1) return `Shot ${count} of ${count}: close on the product in clear hero framing, a satisfying ending.`
  return `Shot ${index + 1} of ${count}: continue the same story naturally, showing the product in use or from a new angle.`
}
