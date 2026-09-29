import { describe, expect, it, vi } from "vitest"

import { createRegisterHandler } from "./route"

describe("POST /api/auth/register", () => {
  it("normalizes email and stores an Argon2 password hash", async () => {
    const createUser = vi.fn().mockResolvedValue({ id: "user_1" })
    const handler = createRegisterHandler({ createUser })
    const response = await handler(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ava Stone",
          email: "  AVA@EXAMPLE.COM ",
          password: "a-strong-password-123",
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ava Stone",
        email: "ava@example.com",
        passwordHash: expect.stringMatching(/^\$argon2id\$/),
      }),
    )
  })

  it("returns field-safe validation errors", async () => {
    const handler = createRegisterHandler({ createUser: vi.fn() })
    const response = await handler(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email", password: "short" }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: "Please check your details." })
  })
})
