import { SiteNav } from "@/components/marketing/sections/nav"
import { Hero } from "@/components/marketing/sections/hero"
import { Platforms } from "@/components/marketing/sections/platforms"
import { Thesis } from "@/components/marketing/sections/thesis"
import { Workflow } from "@/components/marketing/sections/workflow"
import { Automation } from "@/components/marketing/sections/automation"
import { Audience } from "@/components/marketing/sections/audience"
import { Loop } from "@/components/marketing/sections/loop"
import { FounderNote } from "@/components/marketing/sections/founder"
import { Waitlist } from "@/components/marketing/sections/waitlist"
import { SiteFooter } from "@/components/marketing/sections/footer"
import { site } from "@/features/marketing/content"

/**
 * The public landing page.
 *
 * This is the page that shipped as a static export on adcrevia.com, moved into the
 * application unchanged so there is one design and one deployment. The only behavioural
 * difference is where the waitlist posts: a route handler writing a `WaitlistSignup` row
 * instead of a PHP script appending to a file.
 */
const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: site.name,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  url: site.url,
  description: site.description,
  author: { "@type": "Person", name: site.founder.name },
  provider: {
    "@type": "Organization",
    name: site.builtBy.name,
    url: site.builtBy.url,
  },
}

export default function MarketingHome() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static, build-time data with no user input, so there is nothing to escape.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <SiteNav />
      <main id="main">
        <Hero />
        <Platforms />
        <Thesis />
        <Workflow />
        <Automation />
        <Audience />
        <Loop />
        <FounderNote />
        <Waitlist />
      </main>
      <SiteFooter />
    </>
  )
}
