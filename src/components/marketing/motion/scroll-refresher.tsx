"use client";

import { useEffect } from "react";
import { ScrollTrigger } from "@/lib/gsap";

type FailsafeWindow = Window & { __adcreviaRevealFailsafe?: number };

/**
 * Pinned and scrubbed sections measure themselves once. Fonts swapping in and
 * images finishing late both change those measurements, so recalculate after
 * each of those settles. Also stands down the layout's reveal failsafe, since
 * reaching this component proves the animation bundle arrived.
 */
export function ScrollRefresher() {
  useEffect(() => {
    // Reaching this line means GSAP imported and the client bundle is alive,
    // so the layout's un-hide failsafe is no longer needed.
    const scope = window as FailsafeWindow;
    if (scope.__adcreviaRevealFailsafe !== undefined) {
      clearTimeout(scope.__adcreviaRevealFailsafe);
      scope.__adcreviaRevealFailsafe = undefined;
    }

    let frame = 0;

    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => ScrollTrigger.refresh());
    };

    let cancelled = false;
    if (document.fonts) {
      document.fonts.ready.then(() => {
        if (!cancelled) refresh();
      });
    }

    if (document.readyState === "complete") refresh();
    else window.addEventListener("load", refresh);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("load", refresh);
    };
  }, []);

  return null;
}
