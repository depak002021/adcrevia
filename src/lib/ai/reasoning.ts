/**
 * How hard a reasoning model thinks before answering.
 *
 * Nothing set this, so every call ran at the model's default ("medium" for the
 * gpt-5 family): a brief turn took ~12 s, each classifier batch ~13 s and drafting
 * directions ~22 s, and the user watched "Thinking" for a minute. These tasks are
 * structured and well specified; low (or minimal, for yes/no classification) is
 * where they belong.
 *
 * Only sent to models that accept it. A non-reasoning model (gpt-4.1, gpt-4o) would
 * reject the parameter, so it gets nothing.
 */

export type Effort = "minimal" | "low" | "medium"

const REASONING_MODEL = /^(gpt-5|o\d)/i
// gpt-5.1 and later replaced "minimal" with "none"; "low" is accepted everywhere.
const SUPPORTS_MINIMAL = /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/i

export function reasoningFor(model: string, effort: Effort): { reasoning?: { effort: Effort } } {
  if (!REASONING_MODEL.test(model) || /chat/i.test(model)) return {}
  if (effort === "minimal" && !SUPPORTS_MINIMAL.test(model)) return { reasoning: { effort: "low" } }
  return { reasoning: { effort } }
}
