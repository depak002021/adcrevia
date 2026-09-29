import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AdcreviaMark } from "./adcrevia-mark"

describe("AdcreviaMark", () => {
  it("keeps the product name inside an accessible home link", () => {
    render(<AdcreviaMark />)

    expect(screen.getByRole("link", { name: "Adcrevia home" })).toHaveTextContent("Adcrevia")
  })
})
