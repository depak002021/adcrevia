import { describe, expect, it } from "vitest"

import { requireSuperAdmin, requireUser } from "./guards"

function sessionFor(role: "USER" | "SUPER_ADMIN", active = true) {
  return {
    user: {
      id: "user_1",
      email: "studio@adcrevia.test",
      name: "Studio User",
      role,
      active,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  }
}

describe("authorization guards", () => {
  it("rejects a normal user from the super-admin guard", async () => {
    await expect(requireSuperAdmin(sessionFor("USER"))).rejects.toMatchObject({ status: 403 })
  })

  it("allows an active super admin", async () => {
    await expect(requireSuperAdmin(sessionFor("SUPER_ADMIN"))).resolves.toMatchObject({
      role: "SUPER_ADMIN",
    })
  })

  it("rejects inactive users", async () => {
    await expect(requireUser(sessionFor("USER", false))).rejects.toMatchObject({ status: 403 })
  })

  it("requires authentication", async () => {
    await expect(requireUser(null)).rejects.toMatchObject({ status: 401 })
  })
})
