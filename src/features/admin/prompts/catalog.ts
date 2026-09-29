import { BRIEF_INSTRUCTIONS, BRIEF_PROMPT_KEY } from "@/features/brief/prompt"
import {
  CAPTION_INSTRUCTIONS,
  DIRECTIONS_INSTRUCTIONS,
  ENHANCE_INSTRUCTIONS,
  EVALUATION_INSTRUCTIONS,
  PALETTE_INSTRUCTIONS,
  PROMPT_KEYS,
  PROMPT_VARIABLES,
} from "@/lib/ai/instructions"

/**
 * Which prompts an administrator may edit.
 *
 * A fixed catalogue rather than free-form keys. A template only has an effect if some
 * code looks it up by that exact key, so letting somebody invent `agent.director` would
 * produce a saved, activated template that changes nothing — and no way to tell from the
 * console that it is inert.
 *
 * Each entry carries the wording compiled into the application, so the console can show
 * what the code does today and offer it as the starting point for an edit.
 */

export type PromptCatalogEntry = {
  key: string
  label: string
  /** What editing this actually changes, in the user's terms. */
  description: string
  /** Variables the body may reference. Empty means the body is static text. */
  variables: string[]
  /** The wording compiled into the application. */
  fallback: string
}

export const PROMPT_CATALOG: readonly PromptCatalogEntry[] = [
  {
    key: BRIEF_PROMPT_KEY,
    label: "Creative director",
    description:
      "How the assistant behaves during the brief conversation: its tone, how many questions it asks at once, and when it is allowed to start generating.",
    variables: [],
    fallback: BRIEF_INSTRUCTIONS,
  },
  {
    key: PROMPT_KEYS.directions,
    label: "Creative directions",
    description:
      "How the distinct campaign directions are conceived. Must keep `{{count}}`, which is replaced with the project's concept count.",
    variables: PROMPT_VARIABLES[PROMPT_KEYS.directions],
    fallback: DIRECTIONS_INSTRUCTIONS,
  },
  {
    key: PROMPT_KEYS.enhance,
    label: "Brief enhancement",
    description: "How a short product description is strengthened into a photographic brief.",
    variables: PROMPT_VARIABLES[PROMPT_KEYS.enhance],
    fallback: ENHANCE_INSTRUCTIONS,
  },
  {
    key: PROMPT_KEYS.palette,
    label: "Palette suggestion",
    description: "How a brand palette is proposed when the user has not supplied one.",
    variables: PROMPT_VARIABLES[PROMPT_KEYS.palette],
    fallback: PALETTE_INSTRUCTIONS,
  },
  {
    key: PROMPT_KEYS.evaluation,
    label: "Image review rubric",
    description:
      "How generated images are scored on the six axes. Changing the weighting changes which concept is recommended.",
    variables: PROMPT_VARIABLES[PROMPT_KEYS.evaluation],
    fallback: EVALUATION_INSTRUCTIONS,
  },
  {
    key: PROMPT_KEYS.captions,
    label: "Social captions",
    description: "How captions, hashtags and ad copy are written for Instagram, TikTok, YouTube Shorts and Meta ads.",
    variables: PROMPT_VARIABLES[PROMPT_KEYS.captions],
    fallback: CAPTION_INSTRUCTIONS,
  },
] as const

export function findPromptEntry(key: string): PromptCatalogEntry | undefined {
  return PROMPT_CATALOG.find((entry) => entry.key === key)
}
