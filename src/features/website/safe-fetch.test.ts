import type { LookupOptions } from "node:dns"
import { createServer, type Server } from "node:http"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { guardedLookup, safeFetch } from "./safe-fetch"

/**
 * These assertions guard the SSRF boundary, so they test the decision function
 * directly rather than inferring it from network behaviour. `guardedLookup` is
 * what the socket layer calls, so whatever it permits is what gets connected to.
 */

type LookupResult =
  | { error: NodeJS.ErrnoException }
  | { addresses: { address: string; family: number }[] }
  | { address: string; family: number }

/** Drive the callback-style lookup and capture whatever it yields. */
function runLookup(hostname: string, options: LookupOptions): Promise<LookupResult> {
  return new Promise((resolve) => {
    guardedLookup(hostname, options, (error, address, family) => {
      if (error) return resolve({ error: error as NodeJS.ErrnoException })
      if (Array.isArray(address)) return resolve({ addresses: address })
      return resolve({ address, family: family ?? 0 })
    })
  })
}

describe("guardedLookup", () => {
  it("refuses a hostname that resolves to loopback", async () => {
    // `localhost` is guaranteed to resolve to a loopback address on any host, so
    // this exercises the real system resolver rather than a stub.
    const result = await runLookup("localhost", { all: true })

    expect("error" in result).toBe(true)
    if ("error" in result) {
      expect(result.error.message).toBe("BLOCKED_PRIVATE_ADDRESS")
      // Reported as a connection-level refusal, which is what the socket layer
      // expects and what stops a packet ever being sent.
      expect(result.error.code).toBe("EACCES")
    }
  })

  it("refuses loopback in the single-address shape too", async () => {
    // undici may request either shape; both paths have to reject.
    const result = await runLookup("localhost", { family: 4 })

    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error.message).toBe("BLOCKED_PRIVATE_ADDRESS")
  })

  it("passes a public hostname through unchanged", async () => {
    // A stub resolver is not possible here — the point is that the real
    // resolution is the one being checked — so this asserts the permit path
    // using a name that must resolve publicly.
    const result = await runLookup("example.com", { all: true })

    // A sandbox without DNS is a legitimate outcome; what must never happen is a
    // private address being permitted.
    if ("error" in result) {
      expect(result.error.message).not.toBe("BLOCKED_PRIVATE_ADDRESS")
      return
    }

    expect("addresses" in result).toBe(true)
    if ("addresses" in result) {
      expect(result.addresses.length).toBeGreaterThan(0)
      for (const entry of result.addresses) {
        expect(entry.address).not.toMatch(/^(127\.|10\.|192\.168\.|169\.254\.)/)
      }
    }
  })

  it("propagates a genuine resolution failure without disguising it as a block", async () => {
    const result = await runLookup("this-host-does-not-exist.invalid", { all: true })

    expect("error" in result).toBe(true)
    if ("error" in result) {
      // A DNS failure and a policy refusal are different outcomes and must stay
      // distinguishable, so an outage is not misreported as an attack.
      expect(result.error.message).not.toBe("BLOCKED_PRIVATE_ADDRESS")
    }
  })
})

/**
 * End-to-end proof against a real listening socket.
 *
 * This is the attack that matters on the target host: three other production
 * stacks run there with Postgres, Redis and several backends bound on loopback
 * and private Docker networks. A local HTTP server is the closest possible stand-in
 * for one of them.
 *
 * It also covers the case the connect-time guard structurally cannot see — an IP
 * literal, where `net.connect` performs no DNS lookup at all.
 */
describe("safeFetch against a real private listener", () => {
  let server: Server
  let port = 0

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" })
      response.end("<html><body>INTERNAL SERVICE SECRET</body></html>")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    port = typeof address === "object" && address ? address.port : 0
    expect(port).toBeGreaterThan(0)
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it("refuses a loopback IP literal", async () => {
    // The server IS reachable — an unguarded fetch would return the body above.
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(
      "PUBLIC_HTTP_URL_REQUIRED",
    )
  })

  it("refuses the same service addressed by name", async () => {
    await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow(
      "PUBLIC_HTTP_URL_REQUIRED",
    )
  })

  it("confirms the listener really was reachable, so the refusal was the guard", async () => {
    // Without this the tests above would pass just as well against a dead port,
    // proving nothing about the guard.
    const response = await fetch(`http://127.0.0.1:${port}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("INTERNAL SERVICE SECRET")
  })

  it.each([
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
  ])("refuses private target %s", async (url) => {
    // 169.254.169.254 is the cloud metadata endpoint, the highest-value SSRF
    // target on any hosted machine.
    await expect(safeFetch(url)).rejects.toThrow("PUBLIC_HTTP_URL_REQUIRED")
  })

  it("refuses a non-HTTP scheme", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow("PUBLIC_HTTP_URL_REQUIRED")
  })
})
