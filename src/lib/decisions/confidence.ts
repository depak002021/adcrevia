/**
 * Probability maths shared by every decision backend.
 *
 * Confidence is derived here rather than taken from the backend, on purpose.
 * Jev reports a calibrated confidence of its own, but only for `choice` and
 * `score` — a noul answer carries just the probability — and OpenAI reports
 * nothing. Reading the backend's number where it exists and inventing one where
 * it does not would mean a threshold tuned against one backend silently means
 * something different against the other, which defeats the point of making the
 * layer pluggable.
 *
 * So there is one rule for all three question types and both backends:
 * confidence is the margin between the leading outcome and its closest rival.
 * The backend's own number is still recorded on the decision row for audit; it
 * is just not what the code branches on.
 */

/** Clamp to 0..1, mapping NaN and Infinity to 0 rather than propagating them. */
export function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Clamp then rescale to sum to 1.
 *
 * A model asked for a distribution returns something close to one, not one. An
 * all-zero or unusable vector falls back to uniform, because "no information" is
 * a truthful summary of that response and produces zero confidence downstream,
 * whereas leaving the zeros in would produce a spurious margin.
 */
export function normalizeDistribution(values: readonly number[]): number[] {
  if (values.length === 0) return []
  const clamped = values.map(clampProbability)
  const total = clamped.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return clamped.map(() => 1 / clamped.length)
  return clamped.map((value) => value / total)
}

/**
 * Margin between the top two outcomes.
 *
 * Deliberately not `max(p)`: with two options `max(p)` cannot go below 0.5, so a
 * coin flip would score 0.5 while a genuinely uninformative noul scores 0. The
 * margin puts every question type on the same 0..1 scale where 0 means "could go
 * either way" and 1 means "certain".
 */
export function marginConfidence(values: readonly number[]): number {
  if (values.length === 0) return 0
  if (values.length === 1) return 1
  const sorted = [...values].sort((a, b) => b - a)
  return clampProbability(sorted[0] - sorted[1])
}

/**
 * Confidence in a specific selected outcome.
 *
 * Used for `choice`, where the backend states its pick separately from the
 * distribution. When the two disagree the margin goes negative and clamps to 0,
 * so a self-contradicting answer automatically lands on the caller's
 * low-confidence path instead of being trusted.
 */
export function selectionConfidence(values: readonly number[], selectedIndex: number): number {
  if (values.length === 0) return 0
  if (values.length === 1) return 1
  const selected = values[selectedIndex] ?? 0
  const rival = Math.max(...values.filter((_, index) => index !== selectedIndex))
  return clampProbability(selected - rival)
}

/**
 * Expectation over an ordered scale.
 *
 * This is the same quantity Jev returns in `score`: its published example scores
 * 1.04 for the distribution `{1: 0.96, 2: 0.04}`, and `1*0.96 + 2*0.04 = 1.04`.
 * Computing it the same way for the OpenAI backend is what lets a threshold like
 * "above 1.5 on a three-level scale" mean one thing regardless of which backend
 * answered.
 */
export function expectedLevel(values: readonly number[]): number {
  const normalized = normalizeDistribution(values)
  return normalized.reduce((sum, probability, index) => sum + probability * index, 0)
}

/** Index of the largest value. Ties resolve to the lower index. */
export function argmax(values: readonly number[]): number {
  let best = 0
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[best]) best = index
  }
  return best
}

/** Turn a positional distribution into the `{ "0": p, "1": p }` stored shape. */
export function indexedProbabilities(values: readonly number[]): Record<string, number> {
  return Object.fromEntries(values.map((value, index) => [String(index), roundProbability(value)]))
}

/** Turn a positional distribution into `{ optionKey: p }`, preserving key order. */
export function keyedProbabilities(keys: readonly string[], values: readonly number[]): Record<string, number> {
  return Object.fromEntries(keys.map((key, index) => [key, roundProbability(values[index] ?? 0)]))
}

/**
 * Four decimal places, clamped to 0..1.
 *
 * Probabilities are persisted as JSON and shown in an audit view; sixteen digits
 * of float noise is not information, and rounding keeps two backends' answers
 * visually comparable. Not for scores — those live on a 0..levels-1 scale and
 * would be clamped away.
 */
export function roundProbability(value: number): number {
  return Math.round(clampProbability(value) * 10_000) / 10_000
}

/** Four decimal places, unclamped. For values on the score scale. */
export function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10_000) / 10_000
}

/**
 * Index-to-label map for a score question.
 *
 * Stored alongside the answer so a decision row is readable years later without
 * having to find the version of the question that produced it.
 */
export function legendFrom(levels: readonly string[]): Record<string, string> {
  return Object.fromEntries(levels.map((label, index) => [String(index), label]))
}
