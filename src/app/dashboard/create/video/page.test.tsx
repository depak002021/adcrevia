import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  requireUser: vi.fn(),
  resolveActiveVideoProviderName: vi.fn(),
}))

vi.mock("@/lib/auth/guards", () => ({ requireUser: mocks.requireUser }))
vi.mock("@/lib/db/prisma", () => ({
  getPrisma: () => ({ project: { findFirst: mocks.findFirst } }),
}))
vi.mock("@/lib/providers/configuration", () => ({
  resolveActiveVideoProviderName: mocks.resolveActiveVideoProviderName,
}))
vi.mock("@/components/videos/video-generator", () => ({
  VideoGenerator: ({ sources, provider }: { sources: { id: string; url: string; position: number }[]; provider: string }) => (
    <output data-testid="video-generator" data-provider={provider}>
      {sources.map((source) => (
        <span key={source.id} data-testid="scene-source">{`${source.position}:${source.url}`}</span>
      ))}
    </output>
  ),
}))

import CreateVideoPage from "./page"

describe("CreateVideoPage", () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" })
    mocks.resolveActiveVideoProviderName.mockResolvedValue("bfl")
  })

  it("shows the empty state when no completed selection exists", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "project_1",
      imageSelections: [
        { position: 1, image: { id: "img_1", status: "PENDING", url: "https://example.com/first.png" } },
      ],
    })

    render(await CreateVideoPage({ searchParams: Promise.resolve({ project: "project_1" }) }))

    expect(screen.getByRole("heading", { name: /select a completed image first/i })).toBeInTheDocument()
    expect(screen.queryByTestId("video-generator")).not.toBeInTheDocument()
  })

  it("passes only completed selections re-numbered from position one", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "project_1",
      imageSelections: [
        { position: 1, image: { id: "img_1", status: "PENDING", url: "https://example.com/first.png" } },
        { position: 2, image: { id: "img_2", status: "COMPLETED", url: "https://example.com/later.png" } },
        { position: 3, image: { id: "img_3", status: "COMPLETED", url: "https://example.com/last.png" } },
      ],
    })

    render(await CreateVideoPage({ searchParams: Promise.resolve({ project: "project_1" }) }))

    const sources = screen.getAllByTestId("scene-source").map((node) => node.textContent)
    expect(sources).toEqual(["1:https://example.com/later.png", "2:https://example.com/last.png"])
    expect(screen.getByTestId("video-generator")).toHaveAttribute("data-provider", "bfl")
  })
})
