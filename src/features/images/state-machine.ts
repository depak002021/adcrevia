export type ImageState = "PENDING" | "GENERATING" | "COMPLETED" | "FAILED"

const transitions: Record<ImageState, readonly ImageState[]> = {
  PENDING: ["GENERATING"],
  /**
   * PENDING is reachable from GENERATING because of lease recovery: a claim sets
   * a five-minute `leaseExpiresAt`, and if the worker holding it dies the next
   * claim returns the row to the queue. That edge was always exercised by the
   * orchestrator but was missing from this graph, so the graph disagreed with
   * the code it is supposed to describe.
   */
  GENERATING: ["COMPLETED", "FAILED", "PENDING"],
  FAILED: ["PENDING"],
  COMPLETED: [],
}

export function assertImageTransition(from: ImageState, to: ImageState) {
  if (!transitions[from].includes(to)) throw new Error(`ILLEGAL_IMAGE_TRANSITION:${from}:${to}`)
}

/**
 * States a row may legally be in immediately before entering `to`.
 *
 * This is what makes the state machine load-bearing rather than documentation.
 * The repository feeds the result into the `where` clause of its status updates,
 * so an illegal transition is rejected by the database atomically instead of by
 * an assertion that races with a concurrent worker. Previously the graph was
 * exported, unit-tested, and imported by nothing, while the writes bypassed it
 * entirely — which is how videos ended up skipping PENDING.
 */
export function statesAllowedBefore(to: ImageState): ImageState[] {
  return (Object.keys(transitions) as ImageState[]).filter((from) => transitions[from].includes(to))
}

/** No outbound transitions means the row is finished and must never be rewritten. */
export function isTerminalImageState(state: ImageState): boolean {
  return transitions[state].length === 0
}
