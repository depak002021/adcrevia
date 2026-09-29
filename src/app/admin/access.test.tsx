import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const { requireSuperAdmin } = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn().mockResolvedValue({ id: "admin_1", role: "SUPER_ADMIN", active: true }),
}))
vi.mock("@/lib/auth/guards", () => ({ requireSuperAdmin }))

import AdminLayout from "./(protected)/layout"

describe("admin access", () => {
  it("checks the super-admin session before rendering operations content", async () => {
    render(await AdminLayout({ children: <div>Operations only</div> }))
    expect(requireSuperAdmin).toHaveBeenCalledOnce()
    expect(screen.getByText("Operations only")).toBeInTheDocument()
  })
})
