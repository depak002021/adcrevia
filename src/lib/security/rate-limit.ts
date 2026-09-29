import { createHash } from "node:crypto"

import { getPrisma } from "@/lib/db/prisma"

export type RateLimitStore = {
  increment(input: { keyHash: string; action: string; windowStart: Date; expiresAt: Date }): Promise<number>
}

type CheckInput = { action: string; identifier: string; limit: number; windowSeconds: number }

export class RateLimiter {
  constructor(private readonly store: RateLimitStore, private readonly options: { now?: () => Date } = {}) {}

  async check(input: CheckInput) {
    const now = this.options.now?.() ?? new Date()
    const windowMs = input.windowSeconds * 1000
    const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs
    const windowStart = new Date(windowStartMs)
    const expiresAt = new Date(windowStartMs + windowMs)
    const keyHash = createHash("sha256").update(input.identifier.trim().toLowerCase()).digest("hex")
    const count = await this.store.increment({ keyHash, action: input.action, windowStart, expiresAt })
    const allowed = count <= input.limit
    return {
      allowed,
      remaining: Math.max(0, input.limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)),
    }
  }
}

const prismaStore: RateLimitStore = {
  async increment(input) {
    const bucket = await getPrisma().rateLimitBucket.upsert({
      where: { keyHash_action_windowStart: {
        keyHash: input.keyHash,
        action: input.action,
        windowStart: input.windowStart,
      } },
      create: { ...input, count: 1 },
      update: { count: { increment: 1 }, expiresAt: input.expiresAt },
      select: { count: true },
    })
    return bucket.count
  },
}

export const rateLimiter = new RateLimiter(prismaStore)

/**
 * Best-effort client address, for rate limiting only — never for authorisation.
 *
 * Order matters, because the two headers are not equally trustworthy:
 *
 *  - `x-real-ip` is set by the reverse proxy in front of the app (see
 *    deploy/nginx/adcrevia.conf) to the address it actually accepted the
 *    connection from, and it OVERWRITES anything the client sent.
 *  - `x-forwarded-for` is APPENDED to by nginx (`$proxy_add_x_forwarded_for`),
 *    so its first entry is whatever the caller chose to send. Keying a limit on
 *    that entry lets a script rotate a fake value per request and never be
 *    limited. Only the LAST entry was written by our proxy, so that is the one
 *    read when `x-real-ip` is absent.
 */
export function clientIdentifier(request: Request) {
  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp

  const hops = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((hop) => hop.trim())
    .filter(Boolean)
  return hops?.at(-1) || "unknown-client"
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return Response.json(
    { error: "Too many requests. Please wait and try again." },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  )
}
