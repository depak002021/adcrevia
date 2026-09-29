import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const { requireUser } = vi.hoisted(() => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user_1", role: "USER", active: true }),
}))
vi.mock("@/lib/auth/guards", () => ({ requireUser }))

import DashboardLayout from "./layout"

describe("dashboard access", () => {
  it("checks the user session before rendering protected content", async () => {
    render(await DashboardLayout({ children: <div>Private workspace</div> }))
    expect(requireUser).toHaveBeenCalledOnce()
    expect(screen.getByText("Private workspace")).toBeInTheDocument()
  })
})
