import { resolveServiceReadiness, type ServiceReadiness } from "@/lib/config/readiness"
import { getPrisma } from "@/lib/db/prisma"
import { route } from "@/lib/http/route"
import { ffmpegAvailable } from "@/lib/video/ffmpeg"

export const dynamic = "force-dynamic"

/**
 * How long a probe result is reused.
 *
 * This endpoint is unauthenticated by necessity — the container healthcheck and
 * any external monitor have to reach it without credentials — and it previously
 * ran `SELECT 1` on every single request. With a Docker healthcheck polling every
 * few seconds plus an uptime monitor, that is a steady stream of connections, and
 * it is trivially amplified by anyone who finds the URL.
 *
 * Caching in module memory is the right fix rather than a rate limiter: the
 * existing limiter is Postgres-backed, so throttling this route would have
 * replaced one query per request with a write per request. Five seconds is short
 * enough that an orchestrator still detects a real outage within one or two
 * probes.
 */
const PROBE_CACHE_MS = 5_000

/**
 * ffmpeg is cached far longer.
 *
 * A binary does not appear and disappear the way a database connection does, and the
 * probe spawns a process — doing that every five seconds for the lifetime of the
 * container would be a self-inflicted load.
 */
const TOOLING_CACHE_MS = 5 * 60_000

let cachedProbe: { at: number; database: boolean; readiness: ServiceReadiness } | null = null
let cachedTooling: { at: number; ffmpeg: boolean } | null = null

/**
 * Database liveness plus service readiness, cached together. Readiness counts keys
 * entered in the admin console as well as environment variables — see
 * src/lib/config/readiness.ts — so it costs a few indexed reads, which is why it
 * shares the probe cache rather than running per request.
 */
async function probe(): Promise<{ database: boolean; readiness: ServiceReadiness }> {
  const now = Date.now()
  if (cachedProbe && now - cachedProbe.at < PROBE_CACHE_MS) return cachedProbe

  let database = false
  try {
    await getPrisma().$queryRaw`SELECT 1`
    database = true
  } catch {
    database = false
  }
  const readiness = await resolveServiceReadiness(process.env, database)
  cachedProbe = { at: now, database, readiness }
  return cachedProbe
}

/**
 * Is the encoder actually there?
 *
 * Worth reporting because the failure is invisible until somebody renders. ffmpeg is
 * installed by the image rather than by npm, so a base image change or a slimming pass
 * that drops it produces a product where everything works except the thing it is for —
 * and the first sign would be a user's composition failing.
 *
 * Deliberately NOT part of `ready`. The web process never runs ffmpeg; the worker does.
 * Failing the container healthcheck over it would take the whole site down to report a
 * problem with one feature.
 */
async function probeTooling(): Promise<boolean> {
  const now = Date.now()
  if (cachedTooling && now - cachedTooling.at < TOOLING_CACHE_MS) return cachedTooling.ffmpeg

  const { ok } = await ffmpegAvailable().catch(() => ({ ok: false }))
  cachedTooling = { at: now, ffmpeg: ok }
  return ok
}

async function GETHandler() {
  const [{ database, readiness }, ffmpeg] = await Promise.all([probe(), probeTooling()])
  const ready = readiness.ready && database

  return Response.json(
    {
      status: ready ? "ready" : "degraded",
      database,
      services: { ...readiness.services, ffmpeg },
      version:
        process.env.APP_REVISION?.slice(0, 12) ??
        process.env.npm_package_version ??
        "development",
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } },
  )
}

export const GET = route(GETHandler)
