import Image from "next/image";
import { Reveal } from "@/components/ui/reveal";
import { SplitLines } from "@/components/ui/split-lines";
import { audience } from "@/features/marketing/content";
import { cn } from "@/lib/cn";

const [stores, shops, creators, agencies] = audience.items;

function Plate({ src, alt }: { src: string; alt: string }) {
  return (
    <>
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(min-width: 1024px) 60vw, 100vw"
        className="plate-img object-cover"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-ink-2 via-ink-2/72 to-ink-2/25"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-accent/[0.055] mix-blend-color"
      />
    </>
  );
}

function Copy({
  title,
  body,
  className,
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={cn("relative z-10 flex flex-col gap-2.5", className)}>
      <h3 className="text-[1.2rem] font-medium tracking-[-0.02em] text-fg">
        {title}
      </h3>
      <p className="max-w-[38ch] text-[0.93rem] leading-relaxed text-muted">
        {body}
      </p>
    </div>
  );
}

export function Audience() {
  return (
    <section
      id="audience"
      aria-labelledby="audience-heading"
      className="py-24 sm:py-32 lg:py-40"
    >
      <div className="mx-auto w-full max-w-[1400px] px-6 lg:px-10">
        <SplitLines
          as="h2"
          className="max-w-[26ch] text-[1.85rem] leading-[1.1] font-medium tracking-[-0.03em] text-fg sm:text-[2.3rem] lg:text-[2.7rem]"
        >
          {audience.heading}
        </SplitLines>

        <Reveal
          group
          stagger={0.09}
          y={26}
          start="top 85%"
          className="mt-12 grid gap-4 sm:mt-16 lg:grid-cols-12 lg:gap-5"
        >
          <div className="shell lg:col-span-7 lg:row-span-2">
            <div className="core relative flex min-h-[19rem] flex-col justify-end overflow-hidden p-6 lg:min-h-[26rem] lg:p-8">
              <Plate src={stores.image} alt={stores.alt} />
              <Copy title={stores.title} body={stores.body} />
            </div>
          </div>

          <div className="shell lg:col-span-5">
            <div
              className="core flex min-h-[12.5rem] flex-col justify-end p-6 lg:p-7"
              style={{
                backgroundImage:
                  "radial-gradient(120% 130% at 92% 8%, rgba(216,246,81,0.10) 0%, rgba(216,246,81,0) 58%)",
              }}
            >
              <Copy title={shops.title} body={shops.body} />
            </div>
          </div>

          <div className="shell lg:col-span-5">
            <div className="core flex min-h-[12.5rem] flex-col justify-end p-6 lg:p-7">
              <Copy title={creators.title} body={creators.body} />
            </div>
          </div>

          <div className="shell lg:col-span-12">
            <div className="core relative flex min-h-[16rem] flex-col justify-end overflow-hidden p-6 lg:min-h-[17rem] lg:p-8">
              <Plate src={agencies.image} alt={agencies.alt} />
              <Copy
                title={agencies.title}
                body={agencies.body}
                className="lg:max-w-[46ch]"
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
