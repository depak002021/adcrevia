"use client";

import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { scrollToId } from "@/lib/gsap";
import { footer, site } from "@/features/marketing/content";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.055] pt-16 pb-10">
      <div className="mx-auto w-full max-w-[1400px] px-6 lg:px-10">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="text-[1.35rem] font-medium tracking-[-0.03em] text-fg">
              {site.name}
            </p>
            <p className="mt-3 max-w-[34ch] text-[0.92rem] leading-relaxed text-muted">
              {footer.blurb}
            </p>
          </div>

          {footer.columns.map((column) => (
            <nav
              key={column.title}
              aria-label={column.title}
              className="lg:col-span-3"
            >
              <p className="text-[0.85rem] text-fg">{column.title}</p>
              <ul className="mt-4 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.id}>
                    <button
                      type="button"
                      onClick={() => scrollToId(link.id)}
                      className="text-[0.9rem] text-muted transition-colors duration-300 hover:text-fg"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div className="lg:col-span-4">
            <p className="text-[0.85rem] text-fg">Get in touch</p>
            <a
              href={`mailto:${site.contactEmail}`}
              className="mt-4 inline-block text-[0.9rem] text-muted transition-colors duration-300 hover:text-fg"
            >
              {site.contactEmail}
            </a>
            <p className="mt-5 max-w-[38ch] text-[0.8rem] leading-relaxed text-muted">
              We store only what the waitlist form asks for, and we use it to
              plan the rollout. Email us to have your details removed.
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/[0.055] pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.8rem] text-muted">
            &copy; {site.copyrightYear} {site.name}. All rights reserved.
          </p>
          <p className="text-[0.8rem] text-muted">
            Designed, built, and maintained by{" "}
            <a
              href={site.builtBy.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1 text-fg transition-colors duration-300 hover:text-accent"
            >
              {site.builtBy.name}
              <ArrowUpRight
                size={12}
                weight="light"
                aria-hidden="true"
                className="transition-transform duration-500 ease-glide group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
