"use client";

import Image from "next/image";
import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";
import { Reveal } from "@/components/ui/reveal";
import { Eyebrow } from "@/components/marketing/ui/eyebrow";
import { workflow } from "@/features/marketing/content";

const steps = workflow.steps;

export function Workflow() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add(
        "(min-width: 768px) and (prefers-reduced-motion: no-preference)",
        () => {
          const track = trackRef.current;
          const section = sectionRef.current;
          if (!track || !section) return;

          // Recomputed on every refresh so font swaps and late images cannot
          // leave the pan short or overrun.
          const distance = () =>
            Math.max(0, track.scrollWidth - window.innerWidth);

          let lastIndex = -1;

          const pan = gsap.to(track, {
            x: () => -distance(),
            ease: "none",
            scrollTrigger: {
              trigger: section,
              start: "top top",
              end: () => `+=${distance() + window.innerHeight * 0.35}`,
              pin: true,
              scrub: 0.8,
              anticipatePin: 1,
              invalidateOnRefresh: true,
              onUpdate: (self) => {
                gsap.set(railRef.current, { scaleX: self.progress });

                const index = Math.min(
                  steps.length - 1,
                  Math.floor(self.progress * steps.length),
                );
                if (index === lastIndex) return;
                lastIndex = index;

                if (indexRef.current) {
                  indexRef.current.textContent = String(index + 1).padStart(
                    2,
                    "0",
                  );
                }
                if (titleRef.current) {
                  titleRef.current.textContent = steps[index].title;
                  gsap.fromTo(
                    titleRef.current,
                    { opacity: 0, y: 6 },
                    { opacity: 1, y: 0, duration: 0.45, ease: "expo.out" },
                  );
                }
              },
            },
          });

          return () => {
            pan.scrollTrigger?.kill();
            pan.kill();
          };
        },
      );

      return () => mm.revert();
    },
    { scope: sectionRef },
  );

  return (
    <section
      id="workflow"
      ref={sectionRef}
      aria-labelledby="workflow-heading"
      className="relative"
    >
      <div className="flex min-h-[100dvh] flex-col justify-center py-24 md:py-16">
        <Reveal
          group
          stagger={0.08}
          y={20}
          start="top 88%"
          className="mx-auto w-full max-w-[1400px] px-6 lg:px-10"
        >
          <div className="mb-5">
            <Eyebrow>{workflow.eyebrow}</Eyebrow>
          </div>
          <h2
            id="workflow-heading"
            className="max-w-[22ch] text-[1.85rem] leading-[1.08] font-medium tracking-[-0.03em] text-fg sm:text-[2.3rem] lg:text-[2.7rem]"
          >
            {workflow.heading}
          </h2>
          <p className="mt-4 max-w-[52ch] text-[0.97rem] leading-relaxed text-muted">
            {workflow.sub}
          </p>
        </Reveal>

        <div className="mt-10 snap-x snap-mandatory overflow-x-auto pb-2 [scrollbar-width:none] md:mt-12 md:snap-none md:overflow-hidden md:pb-0 [&::-webkit-scrollbar]:hidden">
          <div
            ref={trackRef}
            className="flex w-max gap-4 px-6 will-change-transform lg:gap-5 lg:px-10"
          >
            {steps.map((step) => (
              <article
                key={step.title}
                className="shell w-[78vw] shrink-0 snap-start sm:w-[47vw] lg:w-[32vw] xl:w-[27vw]"
              >
                <div className="core flex h-full flex-col overflow-hidden">
                  <div className="relative aspect-[16/10] w-full overflow-hidden">
                    <Image
                      src={step.image}
                      alt={step.alt}
                      fill
                      sizes="(min-width: 1280px) 27vw, (min-width: 768px) 32vw, 78vw"
                      className="plate-img object-cover"
                    />
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-gradient-to-t from-ink-2 via-ink-2/25 to-transparent"
                    />
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-accent/[0.055] mix-blend-color"
                    />
                  </div>

                  <div className="flex flex-1 flex-col gap-3 px-5 pt-5 pb-5 lg:px-6 lg:pb-6">
                    <h3 className="text-[1.15rem] font-medium tracking-[-0.02em] text-fg">
                      {step.title}
                    </h3>
                    <p className="text-[0.92rem] leading-relaxed text-muted">
                      {step.body}
                    </p>
                    <p className="mt-auto pt-2">
                      <span className="inline-flex rounded-full bg-accent/[0.09] px-3 py-1.5 text-[0.75rem] text-accent">
                        {step.control}
                      </span>
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="mx-auto mt-9 hidden w-full max-w-[1400px] px-6 md:block lg:px-10">
          <div className="flex items-baseline justify-between font-mono text-[0.72rem] tracking-[0.08em] text-faint">
            <span>
              <span ref={indexRef} className="text-fg">
                01
              </span>
              {" / "}
              {String(steps.length).padStart(2, "0")}
            </span>
            <span ref={titleRef} className="text-muted">
              {steps[0].title}
            </span>
          </div>
          <div className="relative mt-3 h-px w-full bg-white/[0.09]">
            <div
              ref={railRef}
              className="absolute inset-0 origin-left scale-x-0 bg-accent"
            />
            <div className="absolute inset-0 flex justify-between">
              {steps.map((step) => (
                <span
                  key={step.title}
                  aria-hidden="true"
                  className="h-2 w-px -translate-y-1/2 bg-white/[0.14]"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
