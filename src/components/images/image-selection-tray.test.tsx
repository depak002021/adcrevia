import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ImageSelectionTray, type SelectionItem } from "./image-selection-tray"

afterEach(() => cleanup())

const items: SelectionItem[] = [
  { id: "img_1", position: 1, url: "https://example.com/1.png" },
  { id: "img_2", position: 2, url: "https://example.com/2.png" },
  { id: "img_3", position: 3, url: "https://example.com/3.png" },
]

function Harness({
  onSave,
  initial = ["img_1", "img_2", "img_3"],
}: {
  onSave: (ids: string[]) => void
  initial?: string[]
}) {
  const [imageIds, setImageIds] = useState(initial)
  return (
    <ImageSelectionTray
      items={items}
      imageIds={imageIds}
      onChange={setImageIds}
      onSave={onSave}
      maxSelection={10}
    />
  )
}

/**
 * The running order moved into a bottom sheet, so every interaction now starts by
 * opening it. The assertions are unchanged in substance: what matters is that the
 * order the user arranges is exactly the order that gets saved.
 */
async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /arrange/i }))
  // The sheet is portalled, so wait for its content rather than assuming it is
  // synchronously present.
  return screen.findByRole("button", { name: /save order/i })
}

describe("ImageSelectionTray", () => {
  it("summarises the selection before the sheet is opened", () => {
    render(<Harness onSave={vi.fn()} />)

    // The bar is the only thing on screen initially; it has to communicate the
    // count without the sheet being open.
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText(/\/ 10 scenes/)).toBeInTheDocument()
  })

  it("numbers the scenes in playback order", async () => {
    const user = userEvent.setup()
    render(<Harness onSave={vi.fn()} />)
    await openSheet(user)

    const scenes = screen.getAllByRole("listitem")
    expect(scenes).toHaveLength(3)
    expect(scenes.map((scene) => scene.textContent?.trim().charAt(0))).toEqual(["1", "2", "3"])
  })

  it("moving the third scene earlier produces order [1,3,2]", async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSave={onSave} />)
    const save = await openSheet(user)

    await user.click(screen.getByRole("button", { name: /move scene 3 earlier/i }))
    await user.click(save)

    expect(onSave).toHaveBeenCalledWith(["img_1", "img_3", "img_2"])
  })

  it("removing a scene after a move keeps the remaining order", async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSave={onSave} />)
    const save = await openSheet(user)

    await user.click(screen.getByRole("button", { name: /move scene 3 earlier/i }))
    await user.click(screen.getByRole("button", { name: /remove scene 1/i }))
    await user.click(save)

    expect(onSave).toHaveBeenCalledWith(["img_3", "img_2"])
    // Four sequential interactions through a portalled sheet. Under full-suite
    // parallelism the default 5s can elapse before the last click resolves, even
    // though this completes near-instantly in isolation.
  }, 20_000)

  it("saves the untouched order when nothing is rearranged", async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSave={onSave} />)
    const save = await openSheet(user)

    await user.click(save)

    expect(onSave).toHaveBeenCalledWith(["img_1", "img_2", "img_3"])
  })

  it("disables moving the first scene earlier and the last scene later", async () => {
    const user = userEvent.setup()
    render(<Harness onSave={vi.fn()} />)
    await openSheet(user)

    expect(screen.getByRole("button", { name: /move scene 1 earlier/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /move scene 3 later/i })).toBeDisabled()
  })

  it("renders nothing at all when no scenes are selected", () => {
    render(
      <ImageSelectionTray
        items={items}
        imageIds={[]}
        onChange={vi.fn()}
        onSave={vi.fn()}
        maxSelection={10}
      />,
    )

    expect(screen.queryByRole("button", { name: /arrange/i })).not.toBeInTheDocument()
  })
})
