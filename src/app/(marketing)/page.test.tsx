import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import MarketingHome from "./page"

describe("MarketingHome", () => {
  // This suite renders the whole page more than once; the config has no global cleanup.
  afterEach(cleanup)

  it("renders the shipped landing page rather than the old placeholder", () => {
    render(<MarketingHome />)

    expect(
      screen.getByRole("heading", { level: 1, name: /turn your products into\s*social videos/i }),
    ).toBeInTheDocument()
    // Every section the static site shipped, reachable by the anchors the nav scrolls to.
    for (const id of ["workflow", "automation", "audience", "waitlist"]) {
      expect(document.getElementById(id), `#${id}`).not.toBeNull()
    }
  })

  it("gives invited users a way into the product from the primary navigation", () => {
    render(<MarketingHome />)

    const primary = screen.getByRole("navigation", { name: "Primary" })
    expect(within(primary).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login")
  })

  it("posts the waitlist to the application, not the retired PHP handler", () => {
    render(<MarketingHome />)

    // The form is the one thing on the page that talks to the server.
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(document.querySelector('form[action*=".php"]')).toBeNull()
  })

  it("describes the product for search engines", () => {
    const { container } = render(<MarketingHome />)

    const script = container.querySelector('script[type="application/ld+json"]')
    expect(JSON.parse(script?.textContent ?? "{}")).toMatchObject({
      "@type": "SoftwareApplication",
      name: "Adcrevia",
    })
  })
})
