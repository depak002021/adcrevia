import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns"
import type { LookupFunction } from "node:net"
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from "undici"

import { assertPublicHttpUrl, isPublicAddress } from "./url-policy"

/**
 * Outbound fetch that cannot be pointed at this host's private network.
 *
 * Why this exists rather than "validate the URL, then fetch it":
 *
 * `fetch` re-resolves DNS at connect time and ignores any pinned Node agent. So
 * a check-then-fetch guard is defeated by DNS rebinding — an attacker returns a
 * public address for the validation lookup and a private one for the connection.
 * This is not theoretical; it is the exact pattern behind a series of 2026
 * SSRF advisories in other products, where the pinned address was simply never
 * the address used for the socket.
 *
 * The only reliable place to check is the resolution the socket itself performs.
 * Undici passes `connect.lookup` straight through to `net.connect`/`tls.connect`,
 * so the callback below IS the connection's resolver: whatever it returns is what
 * gets connected to, and anything private is rejected before a socket exists.
 *
 * Two layers are needed, because they cover different shapes:
 *   - `guardedLookup` here catches HOSTNAMES, at connect time, closing the
 *     rebinding window.
 *   - `assertPublicHttpUrl` catches IP LITERALS, which never reach a resolver at
 *     all — `net.connect` skips DNS when the host is already an address.
 *
 * That matters a great deal here. This deploys onto a host running three other
 * production stacks, with Postgres, Redis and several application backends bound
 * on loopback and private Docker networks.
 */

/** A guard-rejected connection. Distinct so callers can report it precisely. */
export class BlockedAddressError extends Error {
  constructor(public readonly address: string) {
    super("BLOCKED_PRIVATE_ADDRESS")
    this.name = "BlockedAddressError"
  }
}

/**
 * DNS resolver that refuses to hand a private address to the socket layer.
 *
 * Signature matches `net.LookupFunction`, which undici requires. Both the
 * single-address and `all: true` shapes have to be handled because undici may
 * request either.
 *
 * CRITICAL LIMITATION: `net.connect` skips DNS resolution entirely when the host
 * is already an IP literal, so this is never called for `http://10.0.0.1/`. That
 * case is covered by `assertPublicHttpUrl`, which is therefore a genuine part of
 * the boundary and not merely a fast path. The two together cover both shapes:
 * literals at the URL layer, hostnames at the socket layer.
 *
 * Exported for testing: this function is the security decision, so it is
 * asserted directly rather than inferred from network behaviour.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  // `dns.lookup` is overloaded; the cast selects the options-taking overload and
  // the widened callback that goes with it. Both result shapes are normalised
  // below, so nothing downstream depends on which one was requested.
  const resolve = dnsLookup as unknown as (
    host: string,
    opts: LookupOptions,
    done: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => void

  resolve(hostname, options as LookupOptions, (error, address, family) => {
    if (error) return callback(error, "", 0)

    const entries: LookupAddress[] = Array.isArray(address)
      ? address
      : [{ address, family: family ?? 4 }]

    const blocked = entries.find((entry) => !isPublicAddress(entry.address))
    if (blocked) {
      // Surfaced as a connection error, which is what the socket layer expects.
      // Refusing here means no packet is ever sent to the private address.
      const refusal: NodeJS.ErrnoException = new BlockedAddressError(blocked.address)
      refusal.code = "EACCES"
      return callback(refusal, "", 0)
    }

    // Answer in the same shape that was asked for, or undici mis-reads it.
    if (Array.isArray(address)) return callback(null, entries)
    return callback(null, entries[0].address, entries[0].family)
  })
}

/**
 * Dispatcher used for every outbound brand fetch.
 *
 * Kept module-level so connections are pooled across a crawl rather than
 * renegotiating TLS for every page of the same site.
 */
let dispatcher: Agent | null = null

function getDispatcher(): Agent {
  dispatcher ??= new Agent({
    connect: {
      lookup: guardedLookup,
      timeout: 8_000,
    },
    // A brand site should answer quickly. These caps bound how long a slow or
    // deliberately-stalling host can occupy a worker slot.
    headersTimeout: 10_000,
    bodyTimeout: 15_000,
    // Redirect following is refused per-request via `redirect: "manual"` in
    // `safeFetch`, so every hop goes back through the address checks. There is no
    // dispatcher-level redirect option to set here in undici 7 — the request-level
    // one is the control.
    connections: 4,
  })
  return dispatcher
}

export const BRAND_USER_AGENT = "AdcreviaBrandAnalyzer/1.0 (+https://adcrevia.com)"

/**
 * Fetch a public URL, safe on its own.
 *
 * The URL-level check runs HERE rather than being left to callers. The
 * connect-time guard cannot see IP literals — `net.connect` skips DNS when the
 * host is already an address — so a `safeFetch("http://127.0.0.1/")` would
 * otherwise sail straight through a function whose name promises the opposite.
 * Every caller remembering to pre-validate is not a property worth depending on.
 *
 * The cost is one extra resolution per request. For a bounded eight-page crawl
 * that is irrelevant next to being wrong about a security boundary.
 *
 * Always `redirect: "manual"`: a redirect target is a fresh URL that has to go
 * back through the same checks, and letting the client follow it silently would
 * skip them.
 */
export async function safeFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  await assertPublicHttpUrl(typeof url === "string" ? url : url.toString())

  return undiciFetch(url, {
    ...init,
    redirect: "manual",
    dispatcher: getDispatcher(),
    headers: {
      "user-agent": BRAND_USER_AGENT,
      "accept-language": "en",
      ...init.headers,
    },
  })
}

/**
 * Read a response body with a hard byte ceiling.
 *
 * `Content-Length` is a hint an attacker controls, so the limit is enforced while
 * streaming rather than trusted up front. Without this, a host that advertises a
 * small body and then streams indefinitely would exhaust the worker's memory.
 */
export async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("WEBSITE_TOO_LARGE")

  if (!response.body) return ""

  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: false })
  let received = 0
  let text = ""

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) throw new Error("WEBSITE_TOO_LARGE")
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    // Releases the socket back to the pool even when the cap aborted the read.
    reader.releaseLock?.()
    await response.body.cancel().catch(() => {})
  }

  return text + decoder.decode()
}

/**
 * `readCappedText` for binary bodies (product photos). Same streaming ceiling, same
 * reason: the declared length is a hint the remote host controls.
 */
export async function readCappedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("WEBSITE_TOO_LARGE")
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) throw new Error("WEBSITE_TOO_LARGE")
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
    await response.body.cancel().catch(() => {})
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Test seam: drops the pooled dispatcher so a test can assert on a fresh one. */
export async function resetDispatcherForTest() {
  await dispatcher?.close()
  dispatcher = null
}
