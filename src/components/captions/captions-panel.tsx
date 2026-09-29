"use client"

import { useState } from "react"
import { Check, Copy, PenNib } from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"
import { Eyebrow } from "@/components/ui/eyebrow"
import { captionFor, type SocialPlatform } from "@/features/captions/schema"
import { cn } from "@/lib/cn"

import { useSocialCopy } from "./use-social-copy"

const PLATFORMS: Array<{ key: SocialPlatform; label: string }> = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube Shorts" },
  { key: "meta", label: "Meta ad" },
]

/**
 * Captions, hashtags and ad copy for posting, written from the brief and the product
 * facts. One text call when asked (a fraction of a cent); stored, so copying is free.
 */
export function CaptionsPanel({ projectId }: { projectId: string }) {
  const { copy, loaded, writing, error, write } = useSocialCopy(projectId)
  const [platform, setPlatform] = useState<SocialPlatform>("instagram")
  const [copied, setCopied] = useState<string | null>(null)

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied(null), 2_000)
    } catch {
      setCopied(null)
    }
  }

  if (!loaded) return null

  return (
    <section id="captions" className="mt-10 scroll-mt-6 rounded-card p-5 shadow-[inset_0_0_0_1px_var(--line)] sm:p-6" aria-label="Captions">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>Captions</Eyebrow>
          <h2 className="mt-2 text-[1.3rem] leading-tight font-medium tracking-[-0.03em] text-fg">
            {copy ? "Ready to paste under your post." : "Captions and hashtags for posting."}
          </h2>
          <p className="mt-2 max-w-[60ch] text-[0.85rem] leading-relaxed text-muted">
            Written from your brief and the product details, for Instagram, TikTok, YouTube Shorts and Meta ads. Nothing is invented: no prices, offers or claims you did not give.
          </p>
        </div>
        <Button variant={copy ? "secondary" : "primary"} busy={writing} onClick={write} leading={<PenNib size={15} aria-hidden="true" />}>
          {copy ? "Rewrite" : "Write captions"}
        </Button>
      </div>
      {error ? <p className="mt-3 text-[0.82rem] text-danger" role="alert">{error}</p> : null}

      {copy ? (
        <>
          <div className="mt-5 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Platform">
            {PLATFORMS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={platform === item.key}
                onClick={() => setPlatform(item.key)}
                className={cn(
                  "min-h-10 shrink-0 rounded-full px-3.5 text-[0.8rem] transition-colors duration-500 ease-glide",
                  platform === item.key ? "bg-accent/15 text-fg shadow-[inset_0_0_0_1px_--alpha(var(--color-accent)/35%)]" : "text-muted shadow-[inset_0_0_0_1px_var(--line)] hover:text-fg",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-xl bg-white/[0.03] p-4">
            <p className="whitespace-pre-wrap break-words text-[0.9rem] leading-relaxed text-fg">{captionFor(copy, platform)}</p>
            <button
              type="button"
              onClick={() => copyText(captionFor(copy, platform), platform)}
              className="mt-3 flex min-h-10 items-center gap-2 rounded-full px-3.5 text-[0.8rem] text-muted shadow-[inset_0_0_0_1px_var(--line)] hover:text-fg"
            >
              {copied === platform ? <Check size={14} weight="bold" className="text-accent" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied === platform ? "Copied" : "Copy caption"}
            </button>
          </div>

          <div className="mt-4">
            <p className="text-[0.72rem] tracking-[0.08em] text-faint uppercase">Opening lines to test</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {copy.hooks.map((hook, index) => (
                <li key={hook} className="flex items-start justify-between gap-3 text-[0.85rem] text-muted">
                  <span className="min-w-0 break-words">{hook}</span>
                  <button type="button" onClick={() => copyText(hook, `hook-${index}`)} className="shrink-0 text-[0.75rem] text-faint hover:text-fg">
                    {copied === `hook-${index}` ? "Copied" : "Copy"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-4 text-[0.72rem] text-faint">
            Written by {copy.meta_.model}
            {copy.meta_.costUsd !== null ? ` · cost $${copy.meta_.costUsd.toFixed(4)}` : ""}
          </p>
        </>
      ) : (
        <p className="mt-4 text-[0.78rem] text-faint">One short text call, usually well under $0.01. Nothing runs until you press the button.</p>
      )}
    </section>
  )
}
