export type VideoState = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"

const transitions: Record<VideoState, readonly VideoState[]> = {
  PENDING: ["PROCESSING", "FAILED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  FAILED: ["PENDING"],
  COMPLETED: [],
}

export function assertVideoTransition(from: VideoState, to: VideoState) {
  if (!transitions[from].includes(to)) throw new Error(`ILLEGAL_VIDEO_TRANSITION:${from}:${to}`)
}

/**
 * States a row may legally be in immediately before entering `to`. Used in the
 * `where` clause of status updates so the database rejects an illegal
 * transition atomically. See the image state machine for the fuller rationale.
 */
export function statesAllowedBefore(to: VideoState): VideoState[] {
  return (Object.keys(transitions) as VideoState[]).filter((from) => transitions[from].includes(to))
}

export function isTerminalVideoState(state: VideoState): boolean {
  return transitions[state].length === 0
}
