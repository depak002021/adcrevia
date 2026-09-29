import type { Metadata } from "next"

import { ScrollRefresher } from "@/components/marketing/motion/scroll-refresher"
import { site } from "@/features/marketing/content"

/**
 * Marketing shell.
 *
 * The landing page brings its own navigation and footer, so this layout adds no chrome.
 * What it does own is everything that is specific to the public page and wrong for the
 * studio: search metadata, the skip link to the waitlist, and the ScrollTrigger refresher
 * that the pinned sections depend on. The `js` flag, its failsafe and the grain plate
 * already live in the root layout because the studio uses them too.
 */
export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    absolute: `${site.name} | ${site.tagline}`,
  },
  description: site.description,
  keywords: [
    "product videos",
    "social media video automation",
    "AI video for ecommerce",
    "product to video",
    "reels for online stores",
    "shorts for ecommerce",
  ],
  authors: [{ name: site.founder.name }],
  creator: site.builtBy.name,
  alternates: { canonical: "/" },
  // `openGraph.images` / `twitter.images` are deliberately absent: the
  // opengraph-image and twitter-image file conventions in this folder supply them,
  // and the file convention always wins over this object.
  openGraph: {
    type: "website",
    url: site.url,
    siteName: site.name,
    title: `${site.name} | ${site.tagline}`,
    description: site.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} | ${site.tagline}`,
    description: site.description,
  },
  robots: { index: true, follow: true },
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#waitlist"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[70] focus:rounded-full focus:bg-accent focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-ink"
      >
        Skip to the waitlist
      </a>
      {children}
      <ScrollRefresher />
    </>
  )
}
