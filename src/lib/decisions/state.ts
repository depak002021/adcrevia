/**
 * Serialising program state for a decision backend.
 *
 * Both backends are metered on input tokens and both have a context ceiling that
 * covers the state plus every question in the batch (Jev: 64k for the batch, 32k
 * for the state plus the longest single question). State here is assembled from
 * things with no natural size limit — a conversation transcript, a scraped page,
 * a list of directions — so it has to be bounded before it is sent, not after a
 * 400 comes back.
 *
 * Truncation happens per field rather than on the serialised whole, so that a long
 * page body cannot push the user's actual message out of the payload. The shape of
 * the state is what the question instructions refer to by name, and losing a named
 * field silently would change what the question means.
 */

/** Conservative characters-per-token estimate for English prose and JSON. */
const CHARS_PER_TOKEN = 3.6

/** Token budget for the state. Well under the 32k ceiling, since questions count too. */
const DEFAULT_TOKEN_BUDGET = 6_000

const MARKER = "…[truncated]"

export type SerializedState = {
  /** What is sent as `state`. An object, which both backends accept. */
  value: Record<string, unknown>
  /** Estimated input tokens, for a caller that wants to log or budget. */
  estimatedTokens: number
  /** True when any field was shortened, so the audit row can say so. */
  truncated: boolean
}

/**
 * Bound a state object to a token budget.
 *
 * Long string fields are shortened proportionally rather than dropped: a question
 * that asks about `page.body` must still find a `page.body`, and an empty one
 * would be answered confidently and wrongly.
 */
export function serializeState(
  state: Record<string, unknown>,
  tokenBudget = DEFAULT_TOKEN_BUDGET,
): SerializedState {
  const charBudget = Math.floor(tokenBudget * CHARS_PER_TOKEN)
  const raw = safeJson(state)

  if (raw.length <= charBudget) {
    return { value: state, estimatedTokens: estimateTokens(raw), truncated: false }
  }

  // Shrink the long strings until the whole fits. The ratio is applied to string
  // fields only, because numbers and booleans are not what made it large.
  const ratio = charBudget / raw.length
  const value = shrink(state, ratio, charBudget) as Record<string, unknown>
  const serialized = safeJson(value)
  return { value, estimatedTokens: estimateTokens(serialized), truncated: true }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Shorten a single string field to a character limit, keeping the head. */
export function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text
  if (limit <= MARKER.length) return text.slice(0, Math.max(0, limit))
  return `${text.slice(0, limit - MARKER.length)}${MARKER}`
}

function shrink(value: unknown, ratio: number, floor: number): unknown {
  if (typeof value === "string") {
    // Never shrink a short field to nothing; a 20-character product name carries
    // more signal per character than a 20,000-character page body.
    const limit = Math.max(120, Math.floor(value.length * ratio))
    return truncateText(value, limit)
  }
  if (Array.isArray(value)) {
    // Long arrays lose their tail rather than having every element mangled.
    const keep = Math.max(1, Math.ceil(value.length * Math.min(1, ratio * 2)))
    return value.slice(0, keep).map((item) => shrink(item, ratio, floor))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, shrink(item, ratio, floor)]),
    )
  }
  return value
}

/** JSON.stringify that survives a cycle, since state is assembled from ORM rows. */
function safeJson(value: unknown): string {
  const seen = new WeakSet<object>()
  return (
    JSON.stringify(value, (_key, item) => {
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[circular]"
        seen.add(item)
      }
      return item
    }) ?? ""
  )
}
