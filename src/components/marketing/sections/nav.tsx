"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { gsap, useGSAP, ScrollTrigger, scrollToId, prefersReducedMotion } from "@/lib/gsap";
import { nav, site } from "@/features/marketing/content";
import { Cta } from "@/components/marketing/ui/cta";
import { cn } from "@/lib/cn";

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const [condensed, setCondensed] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useGSAP(() => {
    const trigger = ScrollTrigger.create({
      start: 64,
      end: "max",
      onToggle: (self) => setCondensed(self.isActive),
    });
    return () => trigger.kill();
  }, []);

  useGSAP(
    () => {
      const overlay = overlayRef.current;
      if (!overlay) return;

      const items = overlay.querySelectorAll("[data-menu-item]");
      const quick = prefersReducedMotion();

      if (open) {
        gsap.set(overlay, { autoAlpha: 1, pointerEvents: "auto" });
        gsap.fromTo(
          items,
          { y: 36, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            duration: quick ? 0 : 0.7,
            ease: "expo.out",
            stagger: quick ? 0 : 0.055,
            delay: quick ? 0 : 0.06,
          },
        );
      } else {
        gsap.to(overlay, {
          autoAlpha: 0,
          duration: quick ? 0 : 0.34,
          ease: "power2.inOut",
          onComplete: () => gsap.set(overlay, { pointerEvents: "none" }),
        });
      }
    },
    { dependencies: [open], scope: overlayRef },
  );

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const go = (id: string) => {
    setOpen(false);
    // Wait for the scroll lock to lift before handing the scroll to GSAP,
    // otherwise the tween runs against a locked body and goes nowhere.
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToId(id)));
  };

  return (
    <>
      {/*
        Lifted above the menu overlay (z-50) while it is open. At z-40 the overlay covered
        the header, so the close button was visible through the blur but could not be
        tapped: on a phone the menu could only be dismissed by choosing a link.
      */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 flex justify-center px-4 pt-4 sm:pt-5",
          open ? "z-[51]" : "z-40",
        )}
      >
        <nav
          aria-label="Primary"
          className={cn(
            "relative flex h-14 w-full max-w-[1140px] items-center justify-between rounded-full pr-2 pl-5 transition-all duration-700 ease-glide",
            condensed
              ? "bg-ink-2/72 shadow-[inset_0_0_0_1px_var(--line-soft),0_18px_50px_-30px_rgb(0_0_0/0.9)] backdrop-blur-xl"
              : "bg-transparent shadow-none",
          )}
        >
          <button
            type="button"
            onClick={() =>
              prefersReducedMotion()
                ? window.scrollTo(0, 0)
                : gsap.to(window, {
                    duration: 0.9,
                    ease: "power3.inOut",
                    scrollTo: 0,
                  })
            }
            className="text-[1.06rem] font-medium tracking-[-0.02em] text-fg"
          >
            {site.name}
          </button>

          <ul className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 lg:flex">
            {nav.links.map((link) => (
              <li key={link.id}>
                <button
                  type="button"
                  onClick={() => go(link.id)}
                  className="text-[0.9rem] text-muted transition-colors duration-300 hover:text-fg"
                >
                  {link.label}
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-1.5">
            <Link
              href={nav.signIn.href}
              className="hidden rounded-full px-4 py-2 text-[0.88rem] text-muted transition-colors duration-300 hover:text-fg sm:inline-flex"
            >
              {nav.signIn.label}
            </Link>
            <Cta
              label={nav.cta.label}
              targetId={nav.cta.id}
              glyph="right"
              className="hidden py-1.5 pl-5 text-[0.88rem] sm:inline-flex"
            />
            <button
              ref={toggleRef}
              type="button"
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((value) => !value)}
              className="flex size-11 items-center justify-center rounded-full text-fg transition-colors duration-300 hover:bg-white/[0.06] lg:hidden"
            >
              <span aria-hidden="true" className="relative block h-4 w-5">
                <span
                  className={cn(
                    "absolute left-0 block h-px w-full bg-current transition-transform duration-500 ease-glide",
                    open ? "top-[9.5px] translate-y-0 rotate-45" : "top-[6px]",
                  )}
                />
                <span
                  className={cn(
                    "absolute left-0 block h-px w-full bg-current transition-transform duration-500 ease-glide",
                    open
                      ? "top-[9.5px] translate-y-0 -rotate-45"
                      : "top-[13px]",
                  )}
                />
              </span>
            </button>
          </div>
        </nav>
      </header>

      <div
        id="site-menu"
        ref={overlayRef}
        aria-hidden={!open}
        className="invisible fixed inset-0 z-50 flex flex-col justify-between bg-ink/92 px-6 pt-28 pb-10 opacity-0 backdrop-blur-2xl lg:hidden"
      >
        <ul className="flex flex-col gap-2">
          {nav.links.map((link) => (
            <li key={link.id} data-menu-item="">
              <button
                type="button"
                onClick={() => go(link.id)}
                className="w-full py-3 text-left text-[2rem] leading-tight font-medium tracking-[-0.03em] text-fg"
              >
                {link.label}
              </button>
            </li>
          ))}
        </ul>

        <div data-menu-item="" className="flex flex-col gap-6">
          <Cta
            label={nav.cta.label}
            onClick={() => go(nav.cta.id)}
            className="w-full justify-between"
          />
          <Link
            href={nav.signIn.href}
            onClick={() => setOpen(false)}
            className="text-[1.05rem] text-muted transition-colors duration-300 hover:text-fg"
          >
            {nav.signIn.label}
          </Link>
          <a
            href={`mailto:${site.contactEmail}`}
            className="font-mono text-[0.78rem] tracking-[0.06em] text-faint transition-colors hover:text-muted"
          >
            {site.contactEmail}
          </a>
        </div>
      </div>
    </>
  );
}
