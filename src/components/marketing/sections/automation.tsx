"use client";

import { useMemo, useState } from "react";
import { Reveal } from "@/components/ui/reveal";
import { SplitLines } from "@/components/ui/split-lines";
import { automation } from "@/features/marketing/content";
import { cn } from "@/lib/cn";

type ModeId = (typeof automation.modes)[number]["id"];

const defaults: Record<string, ModeId> = {
  produce: "auto",
  review: "ask",
  publish: "ask",
  learn: "ask",
};

/**
 * The product's central promise, made operable rather than described. Changing
 * a row changes the readout, which is the whole point: automation is a dial the
 * visitor sets, not a plan they are sold.
 */
export function Automation() {
  const [choices, setChoices] = useState<Record<string, ModeId>>(defaults);

  const summary = useMemo(() => {
    const values = Object.values(choices);
    if (values.every((value) => value === "auto")) return automation.summaries.full;
    if (values.every((value) => value === "manual"))
      return automation.summaries.manual;
    return automation.summaries.partial;
  }, [choices]);

  return (
    <section
      id="automation"
      aria-labelledby="automation-heading"
      className="border-t border-white/[0.055] py-24 sm:py-32 lg:py-40"
    >
      <div className="mx-auto grid w-full max-w-[1400px] gap-14 px-6 lg:grid-cols-12 lg:gap-16 lg:px-10">
        <div className="lg:col-span-5">
          <SplitLines
            as="h2"
            className="text-[1.85rem] leading-[1.1] font-medium tracking-[-0.03em] text-fg sm:text-[2.3rem] lg:text-[2.6rem]"
          >
            {automation.heading}
          </SplitLines>
          <Reveal y={18} start="top 88%" className="mt-6">
            <p className="max-w-[44ch] text-[0.99rem] leading-relaxed text-muted">
              {automation.sub}
            </p>
          </Reveal>
        </div>

        <Reveal y={26} start="top 86%" className="lg:col-span-7">
          <div className="shell">
            <div className="core p-6 sm:p-8">
              <div key={summary.title} className="animate-rise">
                <p className="text-[1.15rem] font-medium tracking-[-0.02em] text-accent">
                  {summary.title}
                </p>
                <p className="mt-2 max-w-[46ch] text-[0.92rem] leading-relaxed text-muted">
                  {summary.body}
                </p>
              </div>

              <div className="mt-8 flex flex-col gap-6 border-t border-white/[0.06] pt-7">
                {automation.decisions.map((decision) => {
                  const active = choices[decision.id];
                  const activeIndex = automation.modes.findIndex(
                    (mode) => mode.id === active,
                  );

                  return (
                    <fieldset
                      key={decision.id}
                      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                    >
                      <legend className="sr-only">{decision.label}</legend>
                      <span
                        aria-hidden="true"
                        className="text-[0.94rem] text-fg"
                      >
                        {decision.label}
                      </span>

                      <div className="relative grid w-full shrink-0 grid-cols-3 rounded-full bg-white/[0.04] p-1 shadow-[inset_0_0_0_1px_var(--line-soft)] sm:w-[19.5rem]">
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-accent transition-transform duration-[520ms] ease-glide"
                          style={{
                            transform: `translateX(${activeIndex * 100}%)`,
                          }}
                        />
                        {automation.modes.map((mode) => {
                          const selected = mode.id === active;
                          return (
                            <label
                              key={mode.id}
                              className="relative z-10 cursor-pointer text-center"
                            >
                              <input
                                type="radio"
                                name={`automation-${decision.id}`}
                                value={mode.id}
                                checked={selected}
                                onChange={() =>
                                  setChoices((previous) => ({
                                    ...previous,
                                    [decision.id]: mode.id,
                                  }))
                                }
                                className="peer sr-only"
                              />
                              <span
                                className={cn(
                                  "block rounded-full px-2 py-2 text-[0.79rem] transition-colors duration-300 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
                                  selected
                                    ? "font-medium text-ink"
                                    : "text-muted hover:text-fg",
                                )}
                              >
                                {mode.label}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
