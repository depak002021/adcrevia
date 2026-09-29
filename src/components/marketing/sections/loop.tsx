"use client";

import { useRef } from "react";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import { SplitLines } from "@/components/ui/split-lines";
import { loop } from "@/features/marketing/content";
import { cn } from "@/lib/cn";

const RADIUS = 38;

const nodes = loop.nodes.map((label, index) => {
  const angle = ((-90 + index * (360 / loop.nodes.length)) * Math.PI) / 180;
  return {
    label,
    left: 50 + RADIUS * Math.cos(angle),
    top: 50 + RADIUS * Math.sin(angle),
    isLast: index === loop.nodes.length - 1,
  };
});

export function Loop() {
  const sectionRef = useRef<HTMLElement>(null);
  const arcRef = useRef<SVGCircleElement>(null);
  const nodesRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const arc = arcRef.current;
      const holder = nodesRef.current;
      if (!arc || !holder) return;

      const marks = Array.from(
        holder.querySelectorAll<HTMLElement>("[data-loop-node]"),
      );

      if (prefersReducedMotion()) {
        gsap.set(arc, { drawSVG: "100%" });
        gsap.set(marks, { opacity: 1, scale: 1 });
        return;
      }

      // The stroke draws in scroll time and each node lights as the stroke
      // reaches it, so the diagram is read in order instead of all at once.
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 74%",
          end: "bottom 72%",
          scrub: 0.7,
        },
      });

      timeline.fromTo(
        arc,
        { drawSVG: "0%" },
        { drawSVG: "100%", duration: nodes.length, ease: "none" },
        0,
      );

      marks.forEach((mark, index) => {
        timeline.fromTo(
          mark,
          { opacity: 0.22, scale: 0.9 },
          { opacity: 1, scale: 1, duration: 0.55, ease: "expo.out" },
          Math.max(0.05, index),
        );
      });

      return () => {
        timeline.scrollTrigger?.kill();
        timeline.kill();
      };
    },
    { scope: sectionRef },
  );

  return (
    <section
      ref={sectionRef}
      aria-labelledby="loop-heading"
      className="border-t border-white/[0.055] py-24 sm:py-32 lg:py-40"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col items-center px-6 lg:px-10">
        <SplitLines
          as="h2"
          className="max-w-[20ch] text-center text-[1.85rem] leading-[1.1] font-medium tracking-[-0.03em] text-fg sm:text-[2.3rem] lg:text-[2.7rem]"
        >
          {loop.heading}
        </SplitLines>

        <div
          ref={nodesRef}
          className="relative mt-14 aspect-square w-full max-w-[21rem] sm:mt-16 sm:max-w-[26rem] lg:max-w-[31rem]"
        >
          <div
            aria-hidden="true"
            className="absolute inset-[16%] rounded-full opacity-70"
            style={{
              background:
                "radial-gradient(circle, rgba(216,246,81,0.07) 0%, rgba(216,246,81,0) 70%)",
            }}
          />

          <svg
            viewBox="0 0 100 100"
            aria-hidden="true"
            className="absolute inset-0 h-full w-full"
          >
            <circle
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              stroke="rgb(255 255 255 / 0.085)"
              strokeWidth="0.3"
            />
            <circle
              ref={arcRef}
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              stroke="#d8f651"
              strokeWidth="0.5"
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
            />
          </svg>

          <p className="absolute inset-[19%] flex items-center justify-center text-center text-[0.86rem] leading-relaxed text-muted sm:text-[0.95rem]">
            {loop.sub}
          </p>

          <ol className="absolute inset-0">
            {nodes.map((node) => (
              <li
                key={node.label}
                className="absolute"
                style={{
                  left: `${node.left}%`,
                  top: `${node.top}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <span
                  data-loop-node=""
                  className={cn(
                    "block rounded-full px-3.5 py-1.5 text-[0.76rem] whitespace-nowrap sm:text-[0.82rem]",
                    node.isLast
                      ? "bg-accent font-medium text-ink"
                      : "bg-ink-2 text-fg shadow-[inset_0_0_0_1px_var(--line-soft)]",
                  )}
                >
                  {node.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
