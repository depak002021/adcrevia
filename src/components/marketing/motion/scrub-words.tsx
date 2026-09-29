"use client";

import { useRef, type ElementType, type ReactNode } from "react";
import {
  gsap,
  useGSAP,
  SplitText,
  prefersReducedMotion,
} from "@/lib/gsap";
import { cn } from "@/lib/cn";

/**
 * Reading-paced illumination. Words start dim and come up to full as the
 * statement passes through the viewport, which paces the read instead of
 * dumping a wall of display type at once. Opacity only.
 */
export function ScrubWords({
  children,
  className,
  as: Tag = "p",
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      if (prefersReducedMotion()) {
        gsap.set(el, { opacity: 1 });
        return;
      }

      let split: SplitText | null = null;
      let tween: gsap.core.Tween | null = null;
      let cancelled = false;

      const run = () => {
        if (cancelled || !ref.current) return;

        split = SplitText.create(ref.current, {
          type: "words",
          autoSplit: true,
        });
        gsap.set(ref.current, { opacity: 1 });

        tween = gsap.fromTo(
          split.words,
          { opacity: 0.16 },
          {
            opacity: 1,
            duration: 0.6,
            ease: "none",
            stagger: { each: 0.32 },
            scrollTrigger: {
              trigger: ref.current,
              start: "top 76%",
              end: "bottom 58%",
              scrub: true,
            },
          },
        );
      };

      if (document.fonts && document.fonts.status !== "loaded") {
        document.fonts.ready.then(run);
      } else {
        run();
      }

      return () => {
        cancelled = true;
        tween?.scrollTrigger?.kill();
        tween?.kill();
        split?.revert();
      };
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref} data-split="" className={cn(className)}>
      {children}
    </Tag>
  );
}
