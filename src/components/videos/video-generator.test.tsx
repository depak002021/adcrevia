import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { VideoGenerator } from "./video-generator"

// The ModelSelector fetches /api/videos/models on mount. Default it to an empty
// list so the model dropdown is inert; individual tests override the generate
// response. Returning [] means no model is preselected, so the POST stays
// choice-free (exactly the legacy behavior the payload test asserts).
function modelsResponse() {
  return new Response(JSON.stringify({ models: [] }), { status: 200 })
}

/** Route a fetch call: models endpoint -> empty list; everything else -> handler. */
function routedFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes("/api/videos/models")) return Promise.resolve(modelsResponse())
    return Promise.resolve(handler(String(url), init))
  })
}

beforeEach(() => {
  vi.stubGlobal("fetch", routedFetch(() => new Response(JSON.stringify({ video: null }), { status: 200 })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function makeSources(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `img_${index + 1}`,
    url: `https://example.com/${index + 1}.png`,
    position: index + 1,
  }))
}

describe("VideoGenerator", () => {
  it("renders every ordered source as a numbered scene thumbnail", () => {
    const sources = makeSources(3)
    render(
      <VideoGenerator
        projectId="project_1"
        sources={sources}
        provider="bfl"
        supportedAspectRatios={["16:9", "9:16", "1:1", "4:3", "3:4"]}
      />,
    )

    const scenes = screen.getAllByTestId("storyboard-scene")
    expect(scenes).toHaveLength(3)
    expect(scenes.map((scene) => scene.querySelector("[data-testid='scene-number']")?.textContent)).toEqual(["1", "2", "3"])

    const thumbnails = screen.getAllByRole("img")
    expect(thumbnails.map((thumbnail) => thumbnail.getAttribute("src"))).toEqual([
      "https://example.com/1.png",
      "https://example.com/2.png",
      "https://example.com/3.png",
    ])
  })

  it("keeps the minimum duration at 5 seconds for a single scene", () => {
    render(
      <VideoGenerator
        projectId="project_1"
        sources={makeSources(1)}
        provider="bfl"
        supportedAspectRatios={["16:9", "9:16", "1:1", "4:3", "3:4"]}
      />,
    )

    const duration = screen.getByLabelText(/duration/i) as HTMLSelectElement
    const values = Array.from(duration.options).map((option) => Number(option.value))
    expect(Math.min(...values)).toBe(5)
    // Single renders go to 20 s; beyond that a 30 s reel (clips joined) is offered.
    expect(values.filter((value) => value <= 20).at(-1)).toBe(20)
    expect(values.filter((value) => value > 20)).toEqual([30])
  })

  it("defaults Veo to its longest single clip, not a multi-clip reel, and prefills the brief", () => {
    render(
      <VideoGenerator
        projectId="project_1"
        sources={makeSources(2)}
        provider="google"
        supportedAspectRatios={["16:9", "9:16"]}
        defaultPrompt="A student unboxes the earbuds on a Mumbai local train."
      />,
    )

    const duration = screen.getByLabelText(/duration/i) as HTMLSelectElement
    expect(Number(duration.value)).toBe(8)
    expect((screen.getByLabelText(/video prompt/i) as HTMLTextAreaElement).value).toContain("Mumbai local train")
  })

  it("raises the minimum duration to 9 seconds for ten scenes", () => {
    render(
      <VideoGenerator
        projectId="project_1"
        sources={makeSources(10)}
        provider="bfl"
        supportedAspectRatios={["16:9", "9:16", "1:1", "4:3", "3:4"]}
      />,
    )

    const duration = screen.getByLabelText(/duration/i) as HTMLSelectElement
    const values = Array.from(duration.options).map((option) => Number(option.value))
    expect(Math.min(...values)).toBe(9)
    expect(values.filter((value) => value > 20)).toEqual([30])
  })

  it("submits a project-scoped payload with the chosen duration and no client image IDs", async () => {
    const fetchMock = routedFetch(() =>
      new Response(JSON.stringify({ video: { id: "video_1", projectId: "project_1", status: "PROCESSING", progress: 0 } }), { status: 201 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(
      <VideoGenerator
        projectId="project_1"
        sources={makeSources(3)}
        provider="bfl"
        supportedAspectRatios={["16:9", "9:16", "1:1", "4:3", "3:4"]}
      />,
    )

    await user.type(screen.getByLabelText(/video prompt/i), "Slow cinematic orbit across the scenes")
    await user.selectOptions(screen.getByLabelText(/duration/i), "7")
    await user.click(screen.getByRole("button", { name: /generate video/i }))

    const generateCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/videos/generate") as [string, RequestInit]
    expect(generateCall).toBeDefined()
    const payload = JSON.parse(String(generateCall[1].body)) as Record<string, unknown>
    expect(payload).toMatchObject({ projectId: "project_1", duration: 7 })
    expect(payload.prompt).toBe("Slow cinematic orbit across the scenes")

    const payloadText = JSON.stringify(payload)
    expect(payloadText).not.toContain("img_1")
    expect(payloadText).not.toContain("img_2")
    expect(payloadText).not.toContain("img_3")
    expect(payload).not.toHaveProperty("imageIds")
    expect(payload).not.toHaveProperty("imageSelections")
    expect(payload).not.toHaveProperty("sources")
  })

  it("disables submission for Runway with multiple sources and shows the safe configuration message", () => {
    render(
      <VideoGenerator
        projectId="project_1"
        sources={makeSources(3)}
        provider="runway"
        supportedAspectRatios={["16:9", "9:16", "1:1", "4:5"]}
      />,
    )

    expect(screen.getByRole("button", { name: /generate video/i })).toBeDisabled()
    expect(screen.getByText(/multi-image video provider/i)).toBeInTheDocument()
  })

  it("only renders aspect ratios the active provider supports", () => {
    render(
      <VideoGenerator
        projectId="project_1"
        sources={makeSources(1)}
        provider="runway"
        supportedAspectRatios={["16:9", "9:16", "1:1", "4:5"]}
      />,
    )

    const aspect = screen.getByLabelText(/aspect ratio/i) as HTMLSelectElement
    const values = Array.from(aspect.options).map((option) => option.value)
    expect(values).toEqual(["16:9", "9:16", "1:1", "4:5"])
  })

  it("renders an actionable admin/provider message when the API returns MULTI_IMAGE_REQUIRES_FLUX", async () => {
    const fetchMock = routedFetch(() =>
      new Response(JSON.stringify({ error: "This selection needs the multi-image video provider.", code: "MULTI_IMAGE_REQUIRES_FLUX" }), { status: 422 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(
      <VideoGenerator
        projectId="project_1"
        sources={makeSources(2)}
        provider="bfl"
        supportedAspectRatios={["16:9", "9:16", "1:1", "4:3", "3:4"]}
      />,
    )

    await user.type(screen.getByLabelText(/video prompt/i), "Continuous multi-scene motion story")
    await user.click(screen.getByRole("button", { name: /generate video/i }))

    expect(await screen.findByText(/multi-image video provider/i)).toBeInTheDocument()
  })
})
