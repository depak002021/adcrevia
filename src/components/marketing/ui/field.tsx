"use client";

import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";

type Shared = {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  className?: string;
};

const controlClass =
  "w-full rounded-field bg-white/[0.035] px-4 py-3 text-[0.95rem] text-fg shadow-[inset_0_0_0_1px_var(--line-soft)] transition-shadow duration-300 outline-none focus:shadow-[inset_0_0_0_1px_var(--color-accent)]";

function Frame({
  name,
  label,
  hint,
  error,
  optional,
  className,
  children,
}: Shared & { children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label
        htmlFor={name}
        className="flex items-baseline justify-between gap-3 text-[0.85rem] text-fg"
      >
        <span>{label}</span>
        {optional ? (
          <span className="text-[0.74rem] text-muted">Optional</span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="text-[0.78rem] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="text-[0.78rem] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(name: string, hint?: string, error?: string) {
  if (error) return `${name}-error`;
  if (hint) return `${name}-hint`;
  return undefined;
}

export function TextField({
  type = "text",
  autoComplete,
  required,
  maxLength,
  ...shared
}: Shared & {
  type?: "text" | "email" | "url";
  autoComplete?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <Frame {...shared}>
      <input
        id={shared.name}
        name={shared.name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
        aria-invalid={shared.error ? true : undefined}
        aria-describedby={describedBy(shared.name, shared.hint, shared.error)}
        className={cn(
          controlClass,
          shared.error && "shadow-[inset_0_0_0_1px_var(--color-danger)]",
        )}
      />
    </Frame>
  );
}

export function SelectField({
  options,
  required,
  placeholder,
  ...shared
}: Shared & {
  options: readonly string[];
  required?: boolean;
  placeholder: string;
}) {
  return (
    <Frame {...shared}>
      <div className="relative">
        <select
          id={shared.name}
          name={shared.name}
          required={required}
          defaultValue=""
          aria-invalid={shared.error ? true : undefined}
          aria-describedby={describedBy(shared.name, shared.hint, shared.error)}
          className={cn(
            controlClass,
            "appearance-none pr-11",
            shared.error && "shadow-[inset_0_0_0_1px_var(--color-danger)]",
          )}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <CaretDown
          size={15}
          weight="light"
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-muted"
        />
      </div>
    </Frame>
  );
}
