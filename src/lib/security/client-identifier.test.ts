import { describe, expect, it } from "vitest"

import { clientIdentifier } from "./rate-limit"

function request(headers: Record<string, string>) {
  return new Request("http://localhost/api/auth/register", { headers })
}

describe("clientIdentifier", () => {
  it("prefers x-real-ip, which the proxy overwrites", () => {
    expect(clientIdentifier(request({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.9")
  })

  it("reads the last x-forwarded-for hop, because only that one was written by our proxy", () => {
    // A caller can send any X-Forwarded-For it likes; nginx appends the real peer.
    expect(clientIdentifier(request({ "x-forwarded-for": "10.9.8.7, 1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9")
  })

  it("cannot be steered by rotating a spoofed first hop", () => {
    const a = clientIdentifier(request({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }))
    const b = clientIdentifier(request({ "x-forwarded-for": "2.2.2.2, 203.0.113.9" }))
    expect(a).toBe(b)
  })

  it("falls back to a shared bucket when there is nothing to go on", () => {
    expect(clientIdentifier(request({}))).toBe("unknown-client")
    expect(clientIdentifier(request({ "x-forwarded-for": " , " }))).toBe("unknown-client")
  })
})
