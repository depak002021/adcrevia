"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { ProjectSnapshot } from "./snapshot"

/**
 * Subscribes to a project's live state.
 *
 * `EventSource` rather than a hand-rolled `fetch` reader: the previous code
 * parsed SSE frames by hand, splitting on `\n\n` and slicing prefixes, which is
 * a surprising amount of protocol to own for no benefit. The browser already
 * implements it, and cookie auth needs no custom headers.
 *
 * The one thing that does need handling is reconnection. The server closes the
 * stream once nothing is in flight, to free a connection on a constrained host —
 * but `EventSource` treats any close as a network failure and retries forever.
 * So a deliberate close from the server is acknowledged by closing our side too,
 * and the caller reopens with `watch()` when it starts more work.
 */
export function useProjectStream(
  projectId: string,
  initial: ProjectSnapshot,
): {
  snapshot: ProjectSnapshot
  /** True while the stream is open. */
  watching: boolean
  /** Open the stream. Safe to call when already open. */
  watch: () => void
  /** Replace local state without waiting for the next frame. */
  apply: (next: ProjectSnapshot) => void
} {
  const [snapshot, setSnapshot] = useState(initial)
  const [watching, setWatching] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)

  const stop = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
    setWatching(false)
  }, [])

  const watch = useCallback(() => {
    if (sourceRef.current) return

    const source = new EventSource(`/api/projects/${projectId}/events`)
    sourceRef.current = source
    setWatching(true)

    source.addEventListener("snapshot", (event) => {
      try {
        setSnapshot(JSON.parse((event as MessageEvent<string>).data) as ProjectSnapshot)
      } catch {
        // A truncated frame is not worth tearing the stream down for; the next
        // one carries the full state anyway.
      }
    })

    source.addEventListener("closed", () => {
      // The server is done talking. Close our side so EventSource does not
      // immediately reconnect to a stream that would only close again.
      stop()
    })

    source.addEventListener("error", () => {
      // EventSource reconnects on its own for transient failures. Only give up
      // once it has actually closed, otherwise a brief blip would stop the UI
      // updating for the rest of the session.
      if (source.readyState === EventSource.CLOSED) stop()
    })
  }, [projectId, stop])

  // Reopen automatically when the page loads mid-run: a reload during a
  // four-minute generation should not leave a static screen.
  useEffect(() => {
    if (initial.busy) watch()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { snapshot, watching, watch, apply: setSnapshot }
}
