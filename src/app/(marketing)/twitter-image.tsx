import { renderShareCard } from "@/features/marketing/share-card"

// Literal values rather than re-exports: Next reads these statically when it builds the
// metadata tags, and they must match shareCardSize in the renderer.
export const alt = "Adcrevia | Turn your products into social videos."
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function Image() {
  return renderShareCard()
}
