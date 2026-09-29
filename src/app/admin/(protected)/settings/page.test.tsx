import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const { getGenerationPolicy } = vi.hoisted(() => ({
  getGenerationPolicy: vi.fn().mockResolvedValue({ defaultImageCount: 7 }),
}))
vi.mock("@/features/admin/settings/service", () => ({ getGenerationPolicy }))

import AdminSettingsPage from "./page"

describe("admin settings page", () => {
  it("renders the configured image count instead of a hard-coded count", async () => {
    render(await AdminSettingsPage())

    expect(screen.getByText(/7 images per project/i)).toBeInTheDocument()
    expect(screen.queryByText(/exactly four/i)).not.toBeInTheDocument()
  })
})
