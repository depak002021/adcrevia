import { requireUser } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"
import { readProjectSnapshot } from "@/features/projects/snapshot"

/**
 * Live project state as Server-Sent Events.
 *
 * This is what replaces the invented progress. The previous flow ran a `for`
 * loop in the browser firing one request per image, advanced a progress bar on a
 * `setInterval`, and guessed the current scene from a loop counter — so the
 * screen could claim "painting scene 3" while the database had nothing running
 * at all.
 *
 * Polling the database rather than LISTEN/NOTIFY is deliberate. NOTIFY needs a
 * dedicated connection per listener, and this deploys onto a host already at its
 * CPU limit with a small connection budget; one indexed query per second per
 * watching tab is the cheaper trade.
 */

export const dynamic = "force-dynamic"

/** How often the snapshot is re-read while work is in flight. */
const POLL_MS = 1_000

/** Comment frame interval. Keeps intermediaries from closing an idle stream. */
const HEARTBEAT_MS = 15_000

/**
 * How long to keep streaming after the last job settles.
 *
 * Without a grace period the stream closes the instant a job finishes, before
 * the client has applied the final frame. It also covers the gap between one job
 * completing and the next being enqueued (generate, then evaluate).
 */
const IDLE_GRACE_MS = 5_000

/** Hard ceiling, so a forgotten background tab cannot hold a connection forever. */
const MAX_STREAM_MS = 30 * 60_000

/**
 * Params are typed explicitly rather than via `RouteContext<...>`. That helper
 * reads from Next's generated route registry, which does not contain a route
 * until a build has run — so a freshly added handler fails typecheck before it
 * has ever been built.
 */
async function GETHandler(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await requireUser()
  const { projectId } = await context.params

  // Ownership is checked before the stream opens, so an unauthorised caller gets
  // a normal 404 rather than an event stream that never emits.
  const initial = await readProjectSnapshot(projectId, user.id)
  if (!initial) return Response.json({ error: "Project not found." }, { status: 404 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const openedAt = Date.now()
      let lastActivityAt = Date.now()
      let lastHeartbeatAt = Date.now()
      let lastSerialized = ""

      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const close = (reason: string) => {
        if (closed) return
        send("closed", { reason })
        closed = true
        try {
          controller.close()
        } catch {
          // Already closed by the platform when the client vanished.
        }
      }

      // The client aborts when the tab navigates away or the component unmounts.
      request.signal.addEventListener("abort", () => {
        closed = true
        try {
          controller.close()
        } catch {
          // Nothing to do; the peer is gone.
        }
      })

      const emit = (snapshot: Awaited<ReturnType<typeof readProjectSnapshot>>) => {
        if (!snapshot) {
          close("project-deleted")
          return false
        }
        const serialized = JSON.stringify(snapshot)
        // Only push on change. A project mid-render is otherwise identical
        // second to second, and re-sending it would make the client re-render
        // the whole grid for nothing.
        if (serialized !== lastSerialized) {
          lastSerialized = serialized
          send("snapshot", snapshot)
        }
        return true
      }

      emit(initial)
      if (initial.busy) lastActivityAt = Date.now()

      while (!closed) {
        await sleep(POLL_MS, request.signal)
        if (closed || request.signal.aborted) break

        if (Date.now() - openedAt > MAX_STREAM_MS) {
          close("max-duration")
          break
        }

        let snapshot: Awaited<ReturnType<typeof readProjectSnapshot>>
        try {
          snapshot = await readProjectSnapshot(projectId, user.id)
        } catch (error) {
          // A transient database error must not tear down the stream; the client
          // would reconnect and re-run this query anyway.
          console.error("[events] snapshot read failed", {
            projectId,
            message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          })
          continue
        }

        if (!emit(snapshot)) break

        if (snapshot?.busy) {
          lastActivityAt = Date.now()
        } else if (Date.now() - lastActivityAt > IDLE_GRACE_MS) {
          // Nothing left to watch. Closing frees a connection on a host with a
          // small budget for them; the client reopens when it starts more work.
          close("idle")
          break
        }

        if (Date.now() - lastHeartbeatAt > HEARTBEAT_MS) {
          lastHeartbeatAt = Date.now()
          // A comment frame: valid SSE, ignored by EventSource, enough to stop a
          // proxy treating the connection as dead.
          if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"))
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // `no-transform` stops a proxy from gzipping and therefore buffering.
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      /**
       * Critical for this deployment. nginx buffers proxied responses by
       * default, which holds every frame until the buffer fills — the stream
       * appears to work locally and delivers nothing through the reverse proxy.
       */
      "x-accel-buffering": "no",
    },
  })
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

export const GET = route(GETHandler)
