import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { listWaitlistSignups } = vi.hoisted(() => ({ listWaitlistSignups: vi.fn() }))
vi.mock("@/features/marketing/service", () => ({ listWaitlistSignups }))

import AdminWaitlistPage from "./page"

describe("admin waitlist", () => {
  afterEach(cleanup)

  it("lists signups with what they sell and where they heard about us", async () => {
    listWaitlistSignups.mockResolvedValue([
      {
        id: "w1",
        name: "Ava Stone",
        email: "ava@example.com",
        sells: "Soy candles",
        businessType: "Online store",
        website: "https://ava.example",
        source: "Google",
        invitedAt: null,
        createdAt: new Date("2026-09-20T10:00:00Z"),
      },
    ])

    render(await AdminWaitlistPage())

    expect(screen.getByRole("heading", { level: 1, name: "Waitlist" })).toBeInTheDocument()
    expect(screen.getByText("ava@example.com")).toBeInTheDocument()
    expect(screen.getByText("Soy candles")).toBeInTheDocument()
    const link = screen.getByRole("link", { name: "ava.example" })
    expect(link).toHaveAttribute("href", "https://ava.example")
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"))
  })

  it("says so plainly when nobody has signed up yet", async () => {
    listWaitlistSignups.mockResolvedValue([])

    render(await AdminWaitlistPage())

    expect(screen.getByText(/no signups yet/i)).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
