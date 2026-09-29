import { describe, expect, it, vi } from "vitest"

vi.mock("@/features/auth/registration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/registration")>()),
  isRegistrationOpen: vi.fn(async () => false),
}))

import { POST } from "./route"

describe("POST /api/auth/register while sign-up is closed", () => {
  it("refuses with 403 and creates nothing", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ava Stone", email: "ava@example.com", password: "a-strong-password-123" }),
      }),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "REGISTRATION_CLOSED" })
  })
})
