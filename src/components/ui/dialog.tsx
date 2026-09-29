"use client"

import type { ReactNode } from "react"
import * as RadixDialog from "@radix-ui/react-dialog"
import { X } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/cn"

/**
 * Centred modal.
 *
 * Replaces a hand-rolled `<div className="preview-backdrop">` that closed on
 * `onMouseDown` and had no Escape handling, no focus trap, no focus restoration
 * and no scroll lock. Radix provides all of those; this wrapper only supplies
 * the shape, the close affordance, and the size scale.
 *
 * On small screens the dialog becomes near-full-bleed rather than a floating
 * card, because a centred card with margins wastes the short axis on a phone —
 * which matters most for the media size, where the whole point is the image.
 */

const sizes = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  /** Sized to the content, for previewing a generated still or clip. */
  media: "max-w-[min(94vw,68rem)]",
} as const

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  children,
  footer,
  className,
  /** Hides the visible heading but keeps it announced. For media-first dialogs. */
  hideTitle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  size?: keyof typeof sizes
  children: ReactNode
  footer?: ReactNode
  className?: string
  hideTitle?: boolean
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            "fixed inset-0 z-[55] bg-ink/82 backdrop-blur-lg",
            "data-[state=open]:animate-scrim-in",
          )}
        />
        <RadixDialog.Content
          aria-describedby={description ? undefined : ""}
          className={cn(
            "fixed top-1/2 left-1/2 z-[56] -translate-1/2",
            "flex max-h-[92dvh] w-[calc(100%-1.5rem)] flex-col",
            "rounded-card bg-ink-2",
            "shadow-[0_40px_120px_-40px_rgb(0_0_0/0.95),inset_0_1px_0_rgb(255_255_255/0.06)]",
            "data-[state=open]:animate-surface-in",
            "focus:outline-none",
            sizes[size],
            className,
          )}
        >
          <div
            className={cn(
              "flex shrink-0 items-start justify-between gap-4 px-6 pt-6",
              hideTitle && "sr-only",
            )}
          >
            <div>
              <RadixDialog.Title className="text-[1.2rem] leading-tight font-medium tracking-[-0.02em] text-fg">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1.5 text-[0.88rem] text-muted">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
          </div>

          {/* Kept outside the sr-only header so a media dialog still has a
              visible way out. */}
          <RadixDialog.Close
            className={cn(
              "absolute top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full",
              "bg-ink/60 text-muted backdrop-blur-sm",
              "transition-colors duration-300 hover:bg-ink/80 hover:text-fg",
            )}
          >
            <span className="sr-only">Close</span>
            <X size={17} weight="light" aria-hidden="true" />
          </RadixDialog.Close>

          <div
            className={cn(
              "scrollbar-slim min-h-0 flex-1 overflow-y-auto px-6",
              hideTitle ? "pt-6" : "pt-5",
              footer ? "pb-5" : "pb-6",
            )}
          >
            {children}
          </div>

          {footer ? <div className="hairline-t shrink-0 px-6 py-4">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export const DialogTrigger = RadixDialog.Trigger
export const DialogClose = RadixDialog.Close
