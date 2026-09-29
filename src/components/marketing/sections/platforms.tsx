import { Reveal } from "@/components/ui/reveal";
import { platforms } from "@/features/marketing/content";

/**
 * Sits under the hero, never inside it. Marks only, no category labels.
 *
 * The marks are the official Simple Icons artwork (CC0), downloaded into
 * public/brand by tools/fetch-images.mjs and served from this domain. Nothing
 * here reaches out to a third-party CDN at runtime.
 */
export function Platforms() {
  return (
    <section
      aria-labelledby="platforms-label"
      className="border-t border-white/[0.055] py-12 sm:py-14"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col items-start gap-8 px-6 sm:flex-row sm:items-center sm:gap-14 lg:px-10">
        <p
          id="platforms-label"
          className="shrink-0 text-[0.82rem] text-faint"
        >
          {platforms.label}
        </p>
        <Reveal
          group
          stagger={0.07}
          y={14}
          start="top 92%"
          className="flex flex-wrap items-center gap-x-10 gap-y-6 sm:gap-x-14"
        >
          {platforms.items.map((platform) => (
            <span key={platform.slug} className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/brand/${platform.slug}.svg`}
                alt={platform.name}
                width={26}
                height={26}
                loading="lazy"
                decoding="async"
                className="h-[26px] w-auto opacity-45 transition-opacity duration-500 ease-glide hover:opacity-85"
              />
            </span>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
