import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * Small uppercase label above a heading. Monospace and letter-spaced so it reads
 * as metadata rather than as copy, which is what lets a section heading sit
 * directly beneath it without competing.
 */
export function Eyebrow({
  children,
  className,
  as: Tag = "p",
}: {
  children: ReactNode
  className?: string
  as?: "p" | "span" | "div"
}) {
  return (
    <Tag
      className={cn(
        "inline-flex items-center gap-2.5 font-mono text-[0.72rem] tracking-[0.14em] text-faint uppercase",
        className,
      )}
    >
      <span aria-hidden="true" className="h-px w-5 bg-current opacity-60" />
      {children}
    </Tag>
  )
}
