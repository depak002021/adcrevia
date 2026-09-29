import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ToastProvider } from "@/components/ui/toast"

import { ShareButton } from "./share-sheet"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const share = vi.fn(async (_data: ShareData) => {})
let activationActive = true

beforeEach(() => {
  share.mockClear()
  activationActive = true
  Object.assign(navigator, { share, canShare: () => true })
  Object.defineProperty(navigator, "userActivation", { configurable: true, get: () => ({ isActive: activationActive }) })
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => {}) } })
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob([new Uint8Array(1024)], { type: "video/mp4" }))))
})

function renderButton() {
  return render(
    <ToastProvider>
      <ShareButton url="/api/compositions/c1/download?preset=reels" publicUrl="https://media.example/reel.mp4" label="Instagram Reels" caption="Colour that lasts #holi" />
    </ToastProvider>,
  )
}

describe("ShareButton", () => {
  it("shares the video file with its caption when the tap is still fresh", async () => {
    renderButton()
    await userEvent.click(await screen.findByRole("button", { name: /share/i }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const data = share.mock.calls[0][0]
    expect(data.files?.[0].type).toBe("video/mp4")
    expect(data.text).toBe("Colour that lasts #holi")
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Colour that lasts #holi")
  })

  it("asks for a second tap when the download outlasted the tap, then shares without downloading again", async () => {
    activationActive = false
    renderButton()
    await userEvent.click(await screen.findByRole("button", { name: /share/i }))
    const again = await screen.findByRole("button", { name: /tap to share/i })
    expect(share).not.toHaveBeenCalled()
    activationActive = true
    await userEvent.click(again)
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
