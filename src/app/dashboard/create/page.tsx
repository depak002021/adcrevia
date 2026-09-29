import { BriefOpener } from "@/components/brief/brief-opener"
import { Eyebrow } from "@/components/ui/eyebrow"

export default function CreateProjectPage() {
  return (
    <main className="mx-auto w-full max-w-[52rem] px-5 pt-8 pb-16 sm:px-8">
      <header className="mb-8">
        <Eyebrow>New creation</Eyebrow>
        <h1 className="mt-3 max-w-[22ch] text-[2rem] leading-tight font-medium tracking-[-0.035em] text-fg sm:text-[2.6rem]">
          What are we shooting?
        </h1>
        <p className="mt-4 max-w-[52ch] text-[0.95rem] leading-relaxed text-muted">
          One sentence is enough to start. Adcrevia asks for whatever else it needs, reads your site
          if you have one, and turns the answers into a campaign.
        </p>
      </header>

      {/*
        The four-field form that used to live here is gone, and so is the four-step
        list above it — it rendered `01 Brief / 02 Directions / 03 Images / 04 Motion`
        with `aria-current` permanently on the first item, so it never advanced and
        actively misinformed assistive technology about where the user was. Position
        now lives in the conversation's own phase, on the project page.
      */}
      <BriefOpener />
    </main>
  )
}
