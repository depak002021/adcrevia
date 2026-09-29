import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import { Providers } from "@/components/providers"
import "./globals.css"

/**
 * One typeface for the whole product, matching the live marketing site.
 * Hierarchy is carried by size, weight and tracking rather than by a second
 * display face — the same discipline that keeps the accent locked to one hue.
 */
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" })

export const metadata: Metadata = {
  title: {
    default: "Adcrevia — Turn your products into social videos",
    template: "%s — Adcrevia",
  },
  description:
    "Adcrevia turns a product brief into campaign-ready images and a finished social video, with you approving every step.",
  applicationName: "Adcrevia",
  icons: { icon: "/favicon.svg" },
}

export const viewport: Viewport = {
  themeColor: "#07080a",
  colorScheme: "dark",
  // The app shell has a fixed bottom navigation bar on small screens, so the
  // viewport has to extend into the safe area for env(safe-area-inset-bottom)
  // to report a usable value.
  viewportFit: "cover",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        {/*
          Marks the document as scripted so scroll-reveal targets may start
          hidden. Without JS nothing is hidden and every page reads normally.

          The timer is the failsafe: if the animation bundle never arrives, the
          flag is dropped and all hidden content becomes visible. The animation
          layer clears the timer as soon as it is running, so this only ever
          fires when something has genuinely gone wrong.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "var d=document.documentElement;d.classList.add('js');" +
              "window.__adcreviaRevealFailsafe=setTimeout(function(){d.classList.remove('js')},5000)",
          }}
        />
        <Providers>{children}</Providers>
        <div className="grain" aria-hidden="true" />
      </body>
    </html>
  )
}
