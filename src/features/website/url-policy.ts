import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

type Address = { address: string; family: number }
export type AddressResolver = (hostname: string) => Promise<readonly Address[]>

const defaultResolver: AddressResolver = (hostname) => lookup(hostname, { all: true, verbatim: true })

/**
 * Cheap pre-flight check on a URL before any connection is attempted.
 *
 * IMPORTANT: this is NOT the security boundary on its own. `fetch` re-resolves
 * DNS at connect time, so a host that answers with a public address here and a
 * private one at connect time would slip past. The real control is the
 * connect-time validation in `safe-fetch.ts`; this exists to fail fast with a
 * clear error for the overwhelmingly common cases (a literal private IP, a
 * non-HTTP scheme, `localhost`) rather than surfacing them as a socket error.
 */
export async function assertPublicHttpUrl(rawUrl: string, resolveAddresses: AddressResolver = defaultResolver) {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error("PUBLIC_HTTP_URL_REQUIRED")
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("PUBLIC_HTTP_URL_REQUIRED")
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("PUBLIC_HTTP_URL_REQUIRED")
  }

  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolveAddresses(hostname)
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("PUBLIC_HTTP_URL_REQUIRED")
  }
  return url
}

/**
 * Whether an IP literal is routable on the public internet.
 *
 * Exported because `safe-fetch.ts` calls it from inside the socket's own DNS
 * lookup, which is the only place the decision is actually binding. Both callers
 * must agree on the ranges, so there is exactly one implementation.
 */
export function isPublicAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0]
  if (normalized.startsWith("::ffff:")) return isPublicAddress(normalized.slice(7))
  if (isIP(normalized) === 6) {
    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("2001:db8:")
    )
  }
  if (isIP(normalized) !== 4) return false
  const [a, b, c] = normalized.split(".").map(Number)
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}
