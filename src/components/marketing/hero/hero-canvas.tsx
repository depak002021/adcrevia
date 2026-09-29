"use client";

import { useEffect, useRef } from "react";
import { gsap, useGSAP, ScrollTrigger, prefersReducedMotion } from "@/lib/gsap";
import { createParticleField, type ParticleField } from "./particle-field";

/**
 * Client leaf for the hero field. The canvas owns its own frame loop, so the
 * only thing React does here is mount it, fade it in, and forward hero scroll
 * progress. No animated value ever passes through component state.
 */
export function HeroCanvas({ sectionId }: { sectionId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<ParticleField | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const field = createParticleField(canvas);
    fieldRef.current = field;

    if (field && !prefersReducedMotion()) {
      gsap.fromTo(
        canvas,
        { opacity: 0 },
        { opacity: 1, duration: 1.8, ease: "power2.out", delay: 0.15 },
      );
    } else if (field) {
      gsap.set(canvas, { opacity: 1 });
    }

    return () => {
      field?.destroy();
      fieldRef.current = null;
    };
  }, []);

  useGSAP(() => {
    if (prefersReducedMotion()) return;

    const trigger = ScrollTrigger.create({
      trigger: `#${sectionId}`,
      start: "top top",
      end: "bottom top",
      onUpdate: (self) => fieldRef.current?.setScrollProgress(self.progress),
    });

    return () => trigger.kill();
  }, [sectionId]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Painted backdrop. Also the graceful result if WebGL2 is unavailable. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 85% at 62% 42%, #12161d 0%, #0a0c10 46%, #07080a 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.16]"
        style={{
          background:
            "radial-gradient(46% 42% at 68% 38%, rgba(216,246,81,0.55) 0%, rgba(216,246,81,0) 72%)",
        }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full opacity-0"
      />
      {/* Left scrim guarantees text contrast over whatever the field is doing. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-ink via-ink/78 to-transparent lg:via-ink/55"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-ink to-transparent"
      />
    </div>
  );
}
