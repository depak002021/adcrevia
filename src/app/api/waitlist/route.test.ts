import { beforeEach, describe, expect, it, vi } from "vitest"

const recordWaitlistSignup = vi.fn()
const check = vi.fn()

vi.mock("@/features/marketing/service", () => ({
  recordWaitlistSignup: (...args: unknown[]) => recordWaitlistSignup(...args),
}))

vi.mock("@/lib/security/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/rate-limit")>()
  return { ...actual, rateLimiter: { check: (...args: unknown[]) => check(...args) } }
})

const { POST } = await import("./route")

const valid = {
  name: "Ava Stone",
  email: "ava@example.com",
  sells: "Handmade candles",
  businessType: "Online store",
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

describe("POST /api/waitlist", () => {
  beforeEach(() => {
    recordWaitlistSignup.mockReset()
    check.mockReset()
    check.mockResolvedValue({ allowed: true, remaining: 7, retryAfterSeconds: 600 })
  })

  it("records a valid signup", async () => {
    recordWaitlistSignup.mockResolvedValue({ ok: true, created: true })

    const response = await post(valid)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(recordWaitlistSignup).toHaveBeenCalledWith(valid)
  })

  it("answers a repeat signup exactly like a new one, so it cannot reveal who is registered", async () => {
    recordWaitlistSignup.mockResolvedValueOnce({ ok: true, created: true })
    const first = await post(valid)
    recordWaitlistSignup.mockResolvedValueOnce({ ok: true, created: false })
    const second = await post(valid)

    expect(second.status).toBe(first.status)
    await expect(second.json()).resolves.toEqual(await first.json())
  })

  it("returns field errors in the shape the form reads", async () => {
    recordWaitlistSignup.mockResolvedValue({ ok: false, fieldErrors: { email: "That does not look like an email address." } })

    const response = await post({ ...valid, email: "nope" })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      fieldErrors: { email: "That does not look like an email address." },
    })
  })

  it("silently accepts and discards a filled honeypot, without spending the rate limit", async () => {
    const response = await post({ ...valid, nickname: "bot" })

    expect(response.status).toBe(202)
    expect(recordWaitlistSignup).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
  })

  it("rate limits by the address the proxy saw, not one the caller made up", async () => {
    check.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 })

    const response = await post(valid, { "x-forwarded-for": "1.2.3.4, 203.0.113.9" })

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("42")
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ action: "waitlist", identifier: "203.0.113.9" }))
    expect(recordWaitlistSignup).not.toHaveBeenCalled()
  })

  it("treats an unreadable body as a validation failure, not a crash", async () => {
    recordWaitlistSignup.mockResolvedValue({ ok: false, fieldErrors: { name: "Tell us what to call you." } })

    const response = await post("{not json")

    expect(response.status).toBe(400)
    expect(recordWaitlistSignup).toHaveBeenCalledWith(null)
  })
})
