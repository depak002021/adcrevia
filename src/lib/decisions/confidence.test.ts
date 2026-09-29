import { describe, expect, it } from "vitest"

import {
  argmax,
  expectedLevel,
  marginConfidence,
  normalizeDistribution,
  selectionConfidence,
} from "./confidence"

describe("normalizeDistribution", () => {
  it("rescales a distribution that does not sum to one", () => {
    // A model asked for a distribution returns something close to one, not one.
    const normalized = normalizeDistribution([0.5, 0.3])
    expect(normalized[0]).toBeCloseTo(0.625, 10)
    expect(normalized[1]).toBeCloseTo(0.375, 10)
    expect(normalized.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10)
  })

  it("falls back to uniform when the vector carries no information", () => {
    // Leaving the zeros in would manufacture a margin of zero-minus-zero and
    // report it as certainty about the first option.
    expect(normalizeDistribution([0, 0, 0])).toEqual([1 / 3, 1 / 3, 1 / 3])
  })

  it("clamps values outside 0..1 instead of propagating them", () => {
    expect(normalizeDistribution([1.5, -0.4])).toEqual([1, 0])
  })

  it("treats NaN as no information rather than poisoning the whole vector", () => {
    expect(normalizeDistribution([Number.NaN, 1])).toEqual([0, 1])
  })
})

describe("marginConfidence", () => {
  it("reports zero for a coin flip", () => {
    expect(marginConfidence([0.5, 0.5])).toBe(0)
  })

  it("reports one for certainty", () => {
    expect(marginConfidence([1, 0])).toBe(1)
  })

  it("puts a noul and a two-option choice on the same scale", () => {
    // max(p) would bottom out at 0.5 for a two-way split, so an uninformative
    // choice would look half-confident while an uninformative noul looked
    // hopeless. The margin makes both zero.
    expect(marginConfidence([0.95, 0.05])).toBeCloseTo(0.9, 10)
    expect(marginConfidence([0.5, 0.5])).toBe(marginConfidence([1 / 3, 1 / 3, 1 / 3]))
  })

  it("ignores everything below the runner-up", () => {
    expect(marginConfidence([0.6, 0.3, 0.05, 0.05])).toBeCloseTo(0.3, 10)
  })
})

describe("selectionConfidence", () => {
  it("measures the lead the selected option holds", () => {
    expect(selectionConfidence([0.87, 0.13, 0], 0)).toBeCloseTo(0.74, 10)
  })

  it("collapses to zero when the stated pick is not the peak", () => {
    // A backend that names one option and then puts its probability mass on
    // another has told us nothing, and must not be acted on.
    expect(selectionConfidence([0.87, 0.13], 1)).toBe(0)
  })

  it("returns full confidence when there is only one option to pick", () => {
    expect(selectionConfidence([1], 0)).toBe(1)
  })
})

describe("expectedLevel", () => {
  /**
   * Both numbers are taken from TypeSafe's published Jev responses. Reproducing
   * them is what makes the OpenAI backend's score comparable: a threshold tuned
   * against Jev keeps its meaning when the backend changes.
   */
  it("reproduces the score Jev reports for its own distributions", () => {
    expect(expectedLevel([0, 0.96, 0.04])).toBeCloseTo(1.04, 10)
    expect(expectedLevel([0, 0.16, 0.84])).toBeCloseTo(1.84, 10)
  })

  it("sits at the bottom of the scale for certainty about the lowest level", () => {
    expect(expectedLevel([1, 0, 0])).toBe(0)
  })

  it("sits at the top of the scale for certainty about the highest level", () => {
    expect(expectedLevel([0, 0, 0, 1])).toBe(3)
  })
})

describe("argmax", () => {
  it("resolves ties to the lower index so the result is deterministic", () => {
    expect(argmax([0.4, 0.4, 0.2])).toBe(0)
  })

  it("finds the peak anywhere in the vector", () => {
    expect(argmax([0.1, 0.2, 0.7])).toBe(2)
  })
})
