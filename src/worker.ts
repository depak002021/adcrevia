import "dotenv/config"

import { startRunner } from "@/lib/jobs/runner"
import { registeredKinds } from "@/lib/jobs/registry"
// Side-effecting import: populates the handler registry.
import "@/lib/jobs/handlers"

/**
 * Worker process entrypoint.
 *
 * Runs from the same image as the web server with a different command, so the two
 * can never drift apart on schema, provider adapters or storage configuration —
 * the class of bug where a worker is still writing last week's column shape.
 *
 * Everything process-shaped lives here (environment, signals, exit codes) and
 * nothing else, so the loop itself stays testable.
 */

const concurrency = positiveInt(process.env.WORKER_CONCURRENCY, 2)
const leaseMs = positiveInt(process.env.WORKER_LEASE_MS, 2 * 60_000)
const idleDelayMs = positiveInt(process.env.WORKER_IDLE_MS, 2_000)

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

if (!process.env.DATABASE_URL) {
  console.error("[worker] DATABASE_URL is required")
  process.exit(1)
}

const kinds = registeredKinds()
if (kinds.length === 0) {
  // Better to refuse to start than to sit in a loop claiming nothing, which
  // looks healthy to an orchestrator.
  console.error("[worker] no job handlers registered")
  process.exit(1)
}

console.info("[worker] starting", {
  concurrency,
  leaseMs,
  kinds,
  revision: process.env.APP_REVISION ?? "development",
})

const runner = startRunner({ concurrency, leaseMs, idleDelayMs })

/**
 * Graceful shutdown.
 *
 * `docker compose down` sends SIGTERM and waits ten seconds before SIGKILL. The
 * runner stops claiming immediately and in-flight handlers observe the abort
 * signal, so a job is either finished or left with an expiring lease that the
 * reclaim sweep returns to the queue. Nothing is lost either way.
 *
 * A second signal exits at once, so an operator holding Ctrl-C is not made to
 * wait out a long render.
 */
let shuttingDown = false
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      console.warn(`[worker] ${signal} again, exiting now`)
      process.exit(130)
    }
    shuttingDown = true
    console.info(`[worker] ${signal} received, finishing in-flight jobs`)
    runner.stop()
  })
}

/**
 * An unhandled rejection means a code path escaped the loop's own error
 * handling. Log and exit non-zero so the container restarts, rather than
 * continuing in an unknown state — the restart is safe because in-flight jobs are
 * recovered by their leases.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[worker] unhandled rejection", {
    message: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
  })
  process.exit(1)
})

await runner.done
console.info("[worker] stopped cleanly")
process.exit(0)
