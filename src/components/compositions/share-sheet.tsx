"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Copy, DownloadSimple, Link as LinkIcon, PenNib, ShareNetwork } from "@phosphor-icons/react/dist/ssr"

import { useSocialCopy } from "@/components/captions/use-social-copy"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { useToast } from "@/components/ui/toast"
import { captionFor, type SocialPlatform } from "@/features/captions/schema"
import { formatBytes } from "@/features/compositions/timeline"
import type { CompositionSnapshot } from "@/features/projects/snapshot"
import { SOCIAL_PRESETS } from "@/lib/video/presets"
import { cn } from "@/lib/cn"

/**
 * Getting the edit out.
 *
 * One encode per destination, chosen before anything runs, because the alternative is a
 * user downloading a vertical master and finding out from Instagram that the feed has
 * cropped it. Each destination is its own job and its own row, so one failing does not
 * take the others with it.
 *
 * Sharing is the Web Share API where it exists and a download everywhere else. A native
 * share sheet on a phone can hand the file straight to the destination app, which is the
 * difference between posting something and remembering to post it later. It is used
 * only when the browser says it can share a file — feature-detected with `canShare`
 * rather than assumed from the presence of `navigator.share`, because desktop Safari has
 * the second without the first.
 */

type ExportStatus = CompositionSnapshot["renders"][number]

/** Which caption goes with which destination. */
const PLATFORM_FOR_PRESET: Record<string, SocialPlatform> = {
  reels: "instagram",
  feed_portrait: "instagram",
  feed_square: "instagram",
  tiktok: "tiktok",
  shorts: "youtube",
  youtube: "youtube",
}

export function ShareSheet({
  projectId,
  open,
  onOpenChange,
  composition,
  onExport,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  composition: CompositionSnapshot
  onExport: (presets: string[]) => Promise<void>
}) {
  const toast = useToast()
  const [chosen, setChosen] = useState<string[]>([])
  const [queueing, setQueueing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  // Stored captions only (no model call) — loaded when the sheet opens.
  const captions = useSocialCopy(projectId, open)

  const byPreset = new Map(composition.renders.map((render) => [render.preset, render]))

  // Preselect whatever has not been encoded yet, so the common case is one tap. A
  // destination that already has a file is left unticked rather than queued again.
  useEffect(() => {
    if (!open) return
    setChosen(SOCIAL_PRESETS.filter((preset) => !byPreset.get(preset.key)?.url).map((preset) => preset.key))
    // Only when the sheet opens: re-running on every frame would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = (key: string) =>
    setChosen((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]))

  const queue = async () => {
    if (chosen.length === 0) return
    setQueueing(true)
    try {
      await onExport(chosen)
      toast({
        tone: "success",
        title: chosen.length === 1 ? "Encoding one version" : `Encoding ${chosen.length} versions`,
        description: "They appear here as they finish.",
      })
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not start",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setQueueing(false)
    }
  }

  const copy = useCallback(
    async (url: string, key: string) => {
      try {
        await navigator.clipboard.writeText(url)
        setCopied(key)
        window.setTimeout(() => setCopied(null), 2_000)
      } catch {
        toast({ tone: "error", title: "Could not copy", description: "Copy the link from the download instead." })
      }
    },
    [toast],
  )

  const pending = composition.renders.filter(
    (render) => render.status === "QUEUED" || render.status === "RENDERING",
  ).length

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Share the edit"
      description="Pick where it is going. Each destination is encoded to that platform's shape."
      snapPoints={[0.7, 0.94]}
      footer={
        <div className="flex items-center justify-between gap-4">
          <p className="text-[0.8rem] text-muted" aria-live="polite">
            {pending > 0
              ? `${pending} still encoding`
              : chosen.length > 0
                ? `${chosen.length} selected`
                : "Nothing selected"}
          </p>
          <Button
            variant="primary"
            well
            glyph="right"
            busy={queueing}
            disabled={chosen.length === 0}
            onClick={queue}
          >
            {chosen.length > 1 ? `Encode ${chosen.length}` : "Encode"}
          </Button>
        </div>
      }
    >
      {captions.loaded && !captions.copy ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-card p-4 shadow-[inset_0_0_0_1px_var(--line)]">
          <p className="min-w-0 flex-1 text-[0.82rem] leading-snug text-muted">
            Add captions and hashtags for each platform, written from your brief. One short text call, usually under $0.01.
          </p>
          <Button variant="secondary" busy={captions.writing} onClick={captions.write} leading={<PenNib size={15} aria-hidden="true" />}>
            Write captions
          </Button>
          {captions.error ? <p className="w-full text-[0.78rem] text-danger">{captions.error}</p> : null}
        </div>
      ) : null}
      <ul className="flex flex-col gap-2 pb-4">
        {SOCIAL_PRESETS.map((preset) => {
          const render = byPreset.get(preset.key)
          const selected = chosen.includes(preset.key)
          const caption = captions.copy ? captionFor(captions.copy, PLATFORM_FOR_PRESET[preset.key] ?? "instagram") : null
          return (
            <li key={preset.key}>
              <div
                className={cn(
                  "flex flex-col gap-3 rounded-card p-4 transition-shadow duration-500 ease-glide",
                  render?.url
                    ? "shadow-[inset_0_0_0_1px_--alpha(var(--color-accent)/28%)]"
                    : "shadow-[inset_0_0_0_1px_var(--line)]",
                )}
              >
                <div className="flex items-start gap-3">
                  {!render?.url ? (
                    <label className="flex min-h-11 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggle(preset.key)}
                        className="size-5 accent-[var(--color-accent)]"
                      />
                      <span className="sr-only">Encode for {preset.label}</span>
                    </label>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mt-2.5 flex size-5 items-center justify-center rounded-full bg-accent text-ink"
                    >
                      <Check size={12} weight="bold" />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-[0.92rem] text-fg">{preset.label}</p>
                    <p className="mt-0.5 font-mono text-[0.7rem] tabular-nums text-faint">
                      {preset.width}×{preset.height} · {preset.aspectRatio}
                      {render?.bytes ? ` · ${formatBytes(render.bytes)}` : ""}
                    </p>
                    <p className="mt-1.5 text-[0.8rem] leading-snug text-muted">
                      {statusLine(render, preset.hint)}
                    </p>
                  </div>
                </div>

                {render?.url ? (
                  <div className="flex flex-wrap gap-2 pl-8">
                    {/* Same-origin download route: the media host has no CORS, so a
                        cross-origin fetch (native share) failed and `download` was ignored. */}
                    <ShareButton
                      url={`/api/compositions/${composition.id}/download?preset=${preset.key}`}
                      publicUrl={render.url}
                      label={preset.label}
                      caption={caption}
                    />
                    <a
                      href={`/api/compositions/${composition.id}/download?preset=${preset.key}`}
                      download
                      className="flex min-h-11 items-center gap-2 rounded-full px-3.5 text-[0.82rem] text-muted shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-500 ease-glide hover:bg-white/[0.05] hover:text-fg"
                    >
                      <DownloadSimple size={15} weight="light" aria-hidden="true" />
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() => copy(render.url!, preset.key)}
                      className="flex min-h-11 items-center gap-2 rounded-full px-3.5 text-[0.82rem] text-muted shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-500 ease-glide hover:bg-white/[0.05] hover:text-fg"
                    >
                      {copied === preset.key ? (
                        <Check size={15} weight="bold" aria-hidden="true" className="text-accent" />
                      ) : (
                        <LinkIcon size={15} weight="light" aria-hidden="true" />
                      )}
                      {copied === preset.key ? "Copied" : "Copy link"}
                    </button>
                    {caption ? (
                      <button
                        type="button"
                        onClick={() => copy(caption, `caption-${preset.key}`)}
                        className="flex min-h-11 items-center gap-2 rounded-full px-3.5 text-[0.82rem] text-muted shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-500 ease-glide hover:bg-white/[0.05] hover:text-fg"
                      >
                        {copied === `caption-${preset.key}` ? (
                          <Check size={15} weight="bold" aria-hidden="true" className="text-accent" />
                        ) : (
                          <Copy size={15} weight="light" aria-hidden="true" />
                        )}
                        {copied === `caption-${preset.key}` ? "Copied" : "Copy caption"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

/**
 * Native share, with the file itself when the browser can take one.
 *
 * Browsers only let a page open the share sheet shortly after a tap (about five
 * seconds of "user activation"). Downloading a 5–10 MB video first used to spend that
 * allowance, so the share was refused and the button looked broken. Now the file is
 * fetched once and kept: if the tap is still fresh the sheet opens straight away,
 * otherwise the button turns into "Tap to share" and the next tap opens it instantly.
 *
 * The caption is copied to the clipboard at the tap, because Instagram and TikTok
 * ignore text passed along with a video; it is ready to paste in the app.
 */
export function ShareButton({ url, publicUrl, label, caption }: { url: string; publicUrl: string; label: string; caption: string | null }) {
  const toast = useToast()
  const [state, setState] = useState<"idle" | "loading" | "ready">("idle")
  const [file, setFile] = useState<File | null>(null)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && typeof navigator.share === "function")
  }, [])

  if (!supported) return null

  const open = async (shared: File | null) => {
    try {
      if (shared && typeof navigator.canShare === "function" && navigator.canShare({ files: [shared] })) {
        await navigator.share({ files: [shared], title: label, ...(caption ? { text: caption } : {}) })
      } else {
        // No file sharing here (some desktop browsers): share the public link instead.
        await navigator.share({ url: publicUrl, title: label, ...(caption ? { text: caption } : {}) })
      }
      setState("idle")
    } catch (error) {
      // Dismissing the native sheet rejects with AbortError: not a failure.
      if (error instanceof Error && error.name === "AbortError") return
      if (error instanceof Error && error.name === "NotAllowedError") {
        setState("ready")
        toast({ tone: "info", title: "Ready to share", description: "Tap Share again to send it." })
        return
      }
      toast({ tone: "error", title: "Could not share", description: "Download it and share it from your gallery." })
    }
  }

  const share = async () => {
    if (caption) {
      // Within the tap, before anything slow; failure here is harmless.
      navigator.clipboard?.writeText(caption).then(
        () => toast({ tone: "success", title: "Caption copied", description: "Paste it when you post." }),
        () => {},
      )
    }
    if (file) return open(file)

    setState("loading")
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error("The file could not be read.")
      const fetched = new File([await response.blob()], `adcrevia-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`, { type: "video/mp4" })
      setFile(fetched)
      const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
      if (activation && !activation.isActive) {
        setState("ready")
        toast({ tone: "info", title: "Ready to share", description: "Tap Share again to send it." })
        return
      }
      await open(fetched)
    } catch {
      setState("idle")
      toast({ tone: "error", title: "Could not prepare the video", description: "Download it and share it from your gallery." })
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      disabled={state === "loading"}
      className="flex min-h-11 items-center gap-2 rounded-full bg-accent/12 px-3.5 text-[0.82rem] text-fg shadow-[inset_0_0_0_1px_--alpha(var(--color-accent)/28%)] transition-colors duration-500 ease-glide hover:bg-accent/20 disabled:opacity-60"
    >
      {state === "loading" ? (
        <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      ) : (
        <ShareNetwork size={15} weight={state === "ready" ? "fill" : "light"} aria-hidden="true" />
      )}
      {state === "loading" ? "Preparing…" : state === "ready" ? "Tap to share" : "Share"}
    </button>
  )
}

function statusLine(render: ExportStatus | undefined, hint: string): string {
  if (!render) return hint
  if (render.status === "COMPLETED") return "Ready."
  if (render.status === "RENDERING") return "Encoding now."
  if (render.status === "QUEUED") return "Queued."
  if (render.status === "FAILED") {
    // The code is operator-facing; the user gets the one thing they can act on.
    return "That version failed. Try encoding it again."
  }
  return hint
}
