"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { scrollToId } from "@/lib/gsap";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost";
type Glyph = "up-right" | "right" | "down-right";

type CtaProps = {
  label: string;
  /** In-page target. Omit for a submit button. */
  targetId?: string;
  variant?: Variant;
  glyph?: Glyph;
  type?: "button" | "submit";
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  onClick?: () => void;
};

const glyphs = {
  "up-right": ArrowUpRight,
  right: ArrowRight,
  "down-right": ArrowDownRight,
};

/**
 * Pill CTA with a nested icon well. The well carries the hover motion so the
 * button reads as hardware rather than a coloured rectangle.
 */
export function Cta({
  label,
  targetId,
  variant = "primary",
  glyph = "up-right",
  type = "button",
  disabled = false,
  busy = false,
  className,
  onClick,
}: CtaProps) {
  const Glyph = glyphs[glyph];

  return (
    <button
      type={type}
      disabled={disabled || busy}
      onClick={() => {
        onClick?.();
        if (targetId) scrollToId(targetId);
      }}
      className={cn(
        "group inline-flex items-center gap-3 rounded-full py-2 pr-2 pl-6 text-[0.95rem] font-medium whitespace-nowrap transition-all duration-500 ease-glide active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55",
        variant === "primary" &&
          "bg-accent text-ink shadow-[0_22px_64px_-26px_rgb(216_246_81/0.5)] hover:bg-[#e2ff62]",
        variant === "ghost" &&
          "text-fg shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-white/[0.05]",
        className,
      )}
    >
      {label}
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 items-center justify-center rounded-full transition-transform duration-500 ease-glide group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105",
          variant === "primary" ? "bg-ink/12" : "bg-white/10",
        )}
      >
        {busy ? (
          <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
        ) : (
          <Glyph size={17} weight="light" />
        )}
      </span>
    </button>
  );
}
