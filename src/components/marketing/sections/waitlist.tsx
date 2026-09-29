"use client";

import { useState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Reveal } from "@/components/ui/reveal";
import { SplitLines } from "@/components/ui/split-lines";
import { Cta } from "@/components/marketing/ui/cta";
import { Eyebrow } from "@/components/marketing/ui/eyebrow";
import { SelectField, TextField } from "@/components/marketing/ui/field";
import { site, waitlist } from "@/features/marketing/content";
import {
  firstFieldErrors,
  honeypotField,
  waitlistEndpoint,
  waitlistFieldOrder,
  waitlistSchema,
} from "@/features/marketing/waitlist";

type Status = "idle" | "submitting" | "success" | "error";

export function Waitlist() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmedEmail, setConfirmedEmail] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    // The decoy is checked first. Anything in it means this was not a person,
    // so show the same confirmation and send nothing anywhere.
    if (String(data.get(honeypotField) ?? "").trim() !== "") {
      setConfirmedEmail(String(data.get("email") ?? ""));
      setStatus("success");
      return;
    }

    const parsed = waitlistSchema.safeParse({
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      sells: String(data.get("sells") ?? ""),
      businessType: String(data.get("businessType") ?? ""),
      website: String(data.get("website") ?? ""),
      source: String(data.get("source") ?? ""),
    });

    if (!parsed.success) {
      const errors = firstFieldErrors(parsed.error);
      setFieldErrors(errors);
      setMessage(waitlist.errorBody);
      setStatus("error");

      const firstBadField = waitlistFieldOrder.find((field) => errors[field]);
      if (firstBadField) {
        form.querySelector<HTMLElement>(`[name="${firstBadField}"]`)?.focus();
      }
      return;
    }

    setStatus("submitting");
    setMessage(null);
    setFieldErrors({});

    try {
      const response = await fetch(waitlistEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      // Third-party endpoints do not always answer with JSON, so a readable
      // body is treated as a bonus rather than a requirement.
      let body: {
        ok?: boolean;
        message?: string;
        /** The application's shared error envelope (rate limit, server fault). */
        error?: string;
        fieldErrors?: Record<string, string>;
      } | null = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok || body?.ok === false) {
        setStatus("error");
        setFieldErrors(body?.fieldErrors ?? {});
        setMessage(body?.message ?? body?.error ?? waitlist.errorBody);
        return;
      }

      setConfirmedEmail(parsed.data.email);
      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
      setMessage(waitlist.networkError);
    }
  }

  const busy = status === "submitting";

  return (
    <section
      id="waitlist"
      aria-labelledby="waitlist-heading"
      className="border-t border-white/[0.055] py-24 sm:py-32 lg:py-40"
    >
      <div className="mx-auto w-full max-w-[1400px] px-6 lg:px-10">
        <Reveal y={28} start="top 88%" className="mx-auto max-w-[54rem]">
          <div className="shell">
            <div className="core p-6 sm:p-10 lg:p-14">
              {status === "success" ? (
                <div role="status" aria-live="polite" className="animate-rise">
                  <CheckCircle
                    size={34}
                    weight="light"
                    aria-hidden="true"
                    className="text-accent"
                  />
                  <h2
                    id="waitlist-heading"
                    className="mt-6 text-[1.7rem] leading-[1.12] font-medium tracking-[-0.03em] text-fg sm:text-[2.1rem]"
                  >
                    {waitlist.successTitle}
                  </h2>
                  <p className="mt-4 max-w-[48ch] text-[1rem] leading-relaxed text-muted">
                    {waitlist.successBody(confirmedEmail)}
                  </p>
                  <p className="mt-8 text-[0.88rem] text-faint">
                    Something to add?{" "}
                    <a
                      href={`mailto:${site.contactEmail}`}
                      className="text-accent underline decoration-accent/35 underline-offset-4 transition-colors hover:decoration-accent"
                    >
                      {site.contactEmail}
                    </a>
                  </p>
                </div>
              ) : (
                <>
                  <Eyebrow>{waitlist.eyebrow}</Eyebrow>
                  <SplitLines
                    as="h2"
                    className="mt-5 text-[1.9rem] leading-[1.08] font-medium tracking-[-0.03em] text-fg sm:text-[2.4rem]"
                  >
                    {waitlist.heading}
                  </SplitLines>
                  <p className="mt-4 max-w-[52ch] text-[0.99rem] leading-relaxed text-muted">
                    {waitlist.sub}
                  </p>

                  {status === "error" && message ? (
                    <p
                      role="alert"
                      className="mt-7 flex items-start gap-2.5 rounded-field bg-danger/[0.07] px-4 py-3 text-[0.88rem] text-fg shadow-[inset_0_0_0_1px_rgb(255_138_112/0.25)]"
                    >
                      <WarningCircle
                        size={17}
                        weight="light"
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-danger"
                      />
                      {message}
                    </p>
                  ) : null}

                  <form
                    onSubmit={onSubmit}
                    noValidate
                    className="relative mt-8 grid gap-5 sm:grid-cols-2"
                  >
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden"
                    >
                      <label htmlFor={honeypotField}>Nickname</label>
                      <input
                        id={honeypotField}
                        name={honeypotField}
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                      />
                    </div>

                    <TextField
                      name="name"
                      label="Name"
                      autoComplete="name"
                      required
                      maxLength={80}
                      error={fieldErrors.name}
                    />
                    <TextField
                      name="email"
                      label="Email"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={160}
                      error={fieldErrors.email}
                    />
                    <TextField
                      name="sells"
                      label="What do you sell?"
                      hint="A line is plenty. It decides which batch you land in."
                      required
                      maxLength={240}
                      error={fieldErrors.sells}
                      className="sm:col-span-2"
                    />
                    <SelectField
                      name="businessType"
                      label="What describes you best?"
                      placeholder="Choose one"
                      options={waitlist.businessTypes}
                      required
                      error={fieldErrors.businessType}
                    />
                    <SelectField
                      name="source"
                      label="How did you hear about us?"
                      placeholder="Choose one"
                      options={waitlist.sources}
                      optional
                      error={fieldErrors.source}
                    />
                    <TextField
                      name="website"
                      label="Website or store link"
                      type="url"
                      autoComplete="url"
                      optional
                      maxLength={200}
                      hint="Helps us understand your catalog before we invite you."
                      error={fieldErrors.website}
                      className="sm:col-span-2"
                    />

                    <div className="mt-2 flex flex-col gap-5 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                      <Cta
                        label={busy ? waitlist.submitting : waitlist.submit}
                        type="submit"
                        busy={busy}
                      />
                      <p className="max-w-[34ch] text-[0.78rem] leading-relaxed text-muted">
                        {waitlist.privacy}
                      </p>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
