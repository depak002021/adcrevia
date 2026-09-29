"use client";

import { HeroCanvas } from "@/components/marketing/hero/hero-canvas";
import { SplitLines } from "@/components/ui/split-lines";
import { Reveal } from "@/components/ui/reveal";
import { Cta } from "@/components/marketing/ui/cta";
import { Eyebrow } from "@/components/marketing/ui/eyebrow";
import { hero, nav } from "@/features/marketing/content";

export function Hero() {
  return (
    <section
      id="hero"
      className="relative flex min-h-[100dvh] flex-col justify-center overflow-hidden pt-24 pb-20 sm:pb-24"
    >
      <HeroCanvas sectionId="hero" />

      <div className="relative z-10 mx-auto w-full max-w-[1400px] px-6 lg:px-10">
        <Reveal group stagger={0.09} y={18} start="top 95%" className="mb-7">
          <div>
            <Eyebrow>{hero.eyebrow}</Eyebrow>
          </div>
        </Reveal>

        <SplitLines
          as="h1"
          immediate
          delay={0.25}
          className="max-w-[24ch] text-[2.65rem] leading-[1.03] font-medium tracking-[-0.035em] text-fg sm:text-[3.6rem] lg:text-[4.5rem]"
        >
          <span className="block">{hero.headlineLead}</span>
          <span className="block text-accent">{hero.headlineAccent}</span>
        </SplitLines>

        <Reveal
          group
          stagger={0.1}
          delay={0.55}
          y={22}
          start="top 95%"
          className="mt-8 flex flex-col gap-9 sm:mt-9"
        >
          <p className="max-w-[46ch] text-[1.03rem] leading-relaxed text-muted sm:text-[1.13rem]">
            {hero.sub}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Cta label={nav.cta.label} targetId={nav.cta.id} />
            <Cta
              label={hero.secondaryCta}
              targetId="workflow"
              variant="ghost"
              glyph="down-right"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
