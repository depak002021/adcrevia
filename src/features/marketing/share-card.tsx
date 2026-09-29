import { ImageResponse } from "next/og"

import { site } from "./content"

/**
 * The social share card, shared by the opengraph-image and twitter-image routes.
 *
 * Ported from the static site. Rendered by Satori, which supports a deliberately small
 * CSS subset: every element holding more than one child needs an explicit display
 * value, and inline text mixing is avoided in favour of stacked rows.
 */
export const shareCardAlt = `${site.name} | ${site.tagline}`
export const shareCardSize = { width: 1200, height: 630 }

export function renderShareCard() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "76px",
          backgroundColor: "#07080a",
          backgroundImage:
            "radial-gradient(70% 60% at 78% 20%, rgba(216,246,81,0.18) 0%, rgba(216,246,81,0) 70%)",
          color: "#f3f4f6",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              display: "flex",
              width: "9px",
              height: "38px",
              borderRadius: "999px",
              backgroundColor: "#d8f651",
            }}
          />
          <div style={{ display: "flex", fontSize: "31px" }}>{site.name}</div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "26px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: "78px",
                lineHeight: 1.05,
                letterSpacing: "-3px",
              }}
            >
              Turn your products into
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "78px",
                lineHeight: 1.05,
                letterSpacing: "-3px",
                color: "#d8f651",
              }}
            >
              social videos.
            </div>
          </div>
          <div style={{ display: "flex", fontSize: "28px", color: "#9ba2ad" }}>
            Early access is opening in batches. Join the waitlist.
          </div>
        </div>

        <div style={{ display: "flex", fontSize: "23px", color: "#7f8792" }}>
          {site.domain}
        </div>
      </div>
    ),
    shareCardSize,
  )
}
