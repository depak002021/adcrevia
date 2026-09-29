import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react"
import Link from "next/link"
import { cva, type VariantProps } from "class-variance-authority"
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr"
// Type-only import from the package root: the `/dist/ssr` entry exports the
// components but not the shared `Icon` type. Types are erased at compile time,
// so this pulls nothing extra into the bundle.
import type { Icon } from "@phosphor-icons/react"

import { cn } from "@/lib/cn"

/**
 * The single button in the product.
 *
 * Shape comes from the live marketing site: a pill with a nested icon "well"
 * that carries the hover motion, so the control reads as hardware rather than a
 * coloured rectangle. Everything else in the app — studio actions, admin
 * actions, form submits — uses the same component with the well switched off,
 * which is what keeps 27 previously-unstyled call sites consistent.
 *
 * Accent discipline: only `primary` is allowed to use the accent fill. Because
 * the accent is light, its text is ink, never white.
 */
const button = cva(
  [
    "group relative inline-flex items-center justify-center whitespace-nowrap",
    "rounded-full font-medium",
    "transition-all duration-500 ease-glide",
    "active:scale-[0.98]",
    "disabled:pointer-events-none disabled:opacity-55",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-ink shadow-[0_22px_64px_-26px_rgb(216_246_81/0.5)] hover:bg-accent-lift",
        secondary:
          "text-fg shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-white/[0.06]",
        ghost: "text-muted hover:bg-white/[0.05] hover:text-fg",
        danger:
          "bg-danger/12 text-danger shadow-[inset_0_0_0_1px_--alpha(var(--color-danger)/35%)] hover:bg-danger/20",
      },
      size: {
        sm: "min-h-9 gap-2 px-4 text-[0.85rem]",
        md: "min-h-11 gap-2.5 px-5 text-[0.92rem]",
        lg: "min-h-13 gap-3 px-6 text-[1rem]",
      },
      /**
       * A full-bleed button on mobile. Kept as a variant rather than left to
       * callers so the 44px minimum touch target is never accidentally lost.
       */
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "secondary", size: "md", block: false },
  },
)

/** Padding is asymmetric when the well is present: the well provides the right inset. */
const wellPadding = { sm: "pr-1.5", md: "pr-2", lg: "pr-2" } as const
const wellSize = { sm: "size-7", md: "size-9", lg: "size-10" } as const
const glyphSize = { sm: 14, md: 17, lg: 18 } as const

const glyphs: Record<"right" | "up-right" | "down-right", Icon> = {
  right: ArrowRight,
  "up-right": ArrowUpRight,
  "down-right": ArrowDownRight,
}

type Shared = VariantProps<typeof button> & {
  children: ReactNode
  /** Nested icon well on the trailing edge. Off by default for dense UI. */
  well?: boolean
  glyph?: keyof typeof glyphs
  /** Leading icon, for action buttons that read better with a verb glyph. */
  leading?: ReactNode
  /** Swaps the well/leading glyph for a spinner and blocks interaction. */
  busy?: boolean
  className?: string
}

function Inner({
  children,
  well,
  glyph = "up-right",
  leading,
  busy,
  variant,
  size = "md",
}: Shared) {
  const Glyph = glyphs[glyph]
  const resolvedSize = size ?? "md"

  return (
    <>
      {busy && !well ? (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
      ) : leading ? (
        <span aria-hidden="true" className="shrink-0">
          {leading}
        </span>
      ) : null}

      {children}

      {well ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full",
            "transition-transform duration-500 ease-glide",
            "group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105",
            wellSize[resolvedSize],
            variant === "primary" ? "bg-ink/12" : "bg-white/10",
          )}
        >
          {busy ? (
            <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          ) : (
            <Glyph size={glyphSize[resolvedSize]} weight="light" />
          )}
        </span>
      ) : null}
    </>
  )
}

export type ButtonProps = Shared &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, well, glyph, leading, busy, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // A busy button is still focusable, but must not fire again. Using
      // aria-disabled alongside the real disabled attribute keeps the label
      // announced while the action is in flight.
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        button({ variant, size, block }),
        well && wellPadding[size ?? "md"],
        className,
      )}
      {...rest}
    >
      <Inner variant={variant} size={size} well={well} glyph={glyph} leading={leading} busy={busy}>
        {children}
      </Inner>
    </button>
  )
})

/**
 * Navigation twin of `Button`. Separate from `asChild` on purpose: the icon well
 * renders extra DOM inside the control, and Radix's Slot pattern would discard
 * it when merging onto a link child.
 */
export function ButtonLink({
  href,
  variant,
  size,
  block,
  well,
  glyph,
  leading,
  className,
  children,
  prefetch,
  target,
  rel,
  download,
}: Shared & {
  href: string
  prefetch?: boolean
  target?: string
  rel?: string
  download?: boolean | string
}) {
  const external = /^https?:\/\//.test(href) || Boolean(download)
  const classes = cn(button({ variant, size, block }), well && wellPadding[size ?? "md"], className)
  const inner = (
    <Inner variant={variant} size={size} well={well} glyph={glyph} leading={leading}>
      {children}
    </Inner>
  )

  // A download or off-site destination must not go through the client router.
  if (external) {
    return (
      <a href={href} className={classes} target={target} rel={rel} download={download}>
        {inner}
      </a>
    )
  }

  return (
    <Link href={href} className={classes} prefetch={prefetch} target={target} rel={rel}>
      {inner}
    </Link>
  )
}
