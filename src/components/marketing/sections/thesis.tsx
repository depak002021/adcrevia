import { ScrubWords } from "@/components/marketing/motion/scrub-words";
import { Reveal } from "@/components/ui/reveal";
import { thesis } from "@/features/marketing/content";

export function Thesis() {
  return (
    <section className="py-28 sm:py-36 lg:py-44">
      <div className="mx-auto w-full max-w-[1400px] px-6 lg:px-10">
        <ScrubWords
          as="p"
          className="max-w-[30ch] text-[1.6rem] leading-[1.24] font-medium tracking-[-0.028em] text-fg sm:text-[2.15rem] lg:text-[2.75rem]"
        >
          {thesis.statement}
        </ScrubWords>

        <Reveal
          y={20}
          start="top 88%"
          className="mt-14 border-t border-white/[0.06] pt-8 lg:ml-[42%] lg:mt-20"
        >
          <p className="max-w-[42ch] text-[1rem] leading-relaxed text-muted">
            {thesis.support}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
