import { NextResponse, type NextRequest } from "next/server"

/**
 * Cross-origin protection for state-changing requests.
 *
 * NOTE ON THE FILENAME: this is `proxy.ts`, not `middleware.ts`. Next.js 16
 * renamed the convention, and the old filename is silently ignored rather than
 * reported as an error — which for a security control means it fails open. It
 * must stay at the same level as `app`, so `src/proxy.ts` alongside `src/app`.
 *
 * Session auth is a cookie, so every mutating API route is reachable by any page
 * that can convince a logged-in browser to issue the request. NextAuth's own
 * endpoints carry a CSRF token, and its cookies are `SameSite=Lax`, which blocks
 * the straightforward cross-site form post — but Lax does not isolate sibling
 * subdomains, and this app is deployed alongside several other stacks on one
 * host, sharing a parent domain. An explicit origin check closes that gap.
 *
 * Why here rather than per-route: this is the only place that sees every request
 * before any handler runs, so a new API route cannot be added without
 * inheriting the check. Per-route code would be opt-in, and the routes most
 * likely to be forgotten are the ones added in a hurry.
 *
 * This runs on the edge runtime, so it must not touch Prisma or Node APIs. It
 * deliberately does no session validation — that belongs in the route handlers
 * where the database is available, and `route()` maps a failed guard to a real
 * 401 instead of a 500.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * NextAuth manages its own CSRF token on these paths and has to accept provider
 * callbacks, so the origin check must not sit in front of them.
 */
const EXEMPT_PREFIXES = ["/api/auth/"]

/** Container healthchecks and uptime monitors send no Origin header. */
const EXEMPT_PATHS = new Set(["/api/health"])

function allowedOrigins(): Set<string> {
  const origins = new Set<string>()
  for (const value of [process.env.APP_URL, process.env.NEXTAUTH_URL]) {
    if (!value) continue
    try {
      origins.add(new URL(value).origin)
    } catch {
      // A malformed value must not lock out every request; the same-origin
      // comparison below still applies.
    }
  }
  return origins
}

export function proxy(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return NextResponse.next()

  const { pathname } = request.nextUrl
  if (EXEMPT_PATHS.has(pathname)) return NextResponse.next()
  if (EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next()

  const origin = request.headers.get("origin")

  // No Origin header at all. Browsers always send one on cross-origin mutating
  // requests, so its absence means a same-origin form post or a non-browser
  // client (curl, the worker, a monitor). Those are not the CSRF threat model,
  // and rejecting them would break legitimate server-to-server calls.
  if (!origin) return NextResponse.next()

  const permitted = allowedOrigins()
  // `request.nextUrl.origin` reflects the forwarded host, so a same-origin
  // request stays valid behind the reverse proxy without trusting a raw header.
  permitted.add(request.nextUrl.origin)

  if (permitted.has(origin)) return NextResponse.next()

  return NextResponse.json(
    { error: "Request blocked: unrecognised origin." },
    { status: 403, headers: { "cache-control": "no-store" } },
  )
}

export const config = {
  /**
   * Only paths that can mutate state. Static assets, image optimisation output
   * and the favicon are excluded so this never sits in the hot path for asset
   * delivery.
   */
  matcher: ["/api/:path*", "/dashboard/:path*", "/admin/:path*"],
}
