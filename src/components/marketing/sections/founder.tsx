import { Reveal } from "@/components/ui/reveal";
import { ScrubWords } from "@/components/marketing/motion/scrub-words";
import { founder, site } from "@/features/marketing/content";

export function FounderNote() {
  return (
    <section
      aria-label={`A note from ${site.founder.name}`}
      className="border-t border-white/[0.055] bg-ink-2/45 py-24 sm:py-28 lg:py-32"
    >
      <div className="mx-auto w-full max-w-[1400px] px-6 lg:px-10">
        <ScrubWords
          as="p"
          className="max-w-[52ch] text-[1.3rem] leading-[1.42] font-medium tracking-[-0.02em] text-fg sm:text-[1.55rem] lg:text-[1.75rem]"
        >
          {founder.note[0]}
        </ScrubWords>

        <Reveal y={20} start="top 88%" className="mt-7 max-w-[58ch]">
          <p className="text-[1rem] leading-relaxed text-muted">
            {founder.note[1]}
          </p>
        </Reveal>

        <Reveal y={16} start="top 92%" className="mt-11">
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-full bg-white/[0.05] font-mono text-[0.82rem] tracking-[0.08em] text-accent shadow-[inset_0_0_0_1px_var(--line-soft)]"
            >
              {site.founder.initials}
            </span>
            <span className="flex flex-col">
              <span className="text-[0.96rem] text-fg">
                {site.founder.name}
              </span>
              <span className="text-[0.86rem] text-muted">
                {site.founder.role}
              </span>
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
