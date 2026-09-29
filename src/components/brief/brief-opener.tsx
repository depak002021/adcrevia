"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Globe, X } from "@phosphor-icons/react/dist/ssr"

import { TextField } from "@/components/ui/field"
import { useToast } from "@/components/ui/toast"
import { BriefComposer } from "./brief-composer"

/**
 * How a project starts now.
 *
 * The form this replaces asked for a twelve-character brief, a website and a colour
 * palette before it would create anything — a validator standing between somebody
 * with an idea and the product that is supposed to help them shape it. Here one
 * sentence is enough, and everything else is a question the agent asks once it has
 * something to ask about.
 *
 * The website field stays, because a URL is the single highest-value thing a user can
 * hand over: it turns an empty brief into a brand, a palette and a product list in
 * one crawl. It is optional and secondary, not a gate.
 */

const MAX_PHOTOS = 6
const MAX_EDGE = 2048

/**
 * Shrink a photo in the browser before upload: at most 2048 px on the long edge, as
 * JPEG. Far more than any model uses as a reference, and it keeps several phone
 * photos inside one request.
 */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.type === "image/jpeg" && file.size < 3_000_000) return file
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext("2d")
    if (!context) return file
    context.fillStyle = "#fff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file
  } catch {
    return file
  }
}

const PROMPTS = [
  "A matte black steel water bottle, for trail runners",
  "Small-batch soy candles, warm and domestic",
  "A ceramic pour-over set for a specialty coffee brand",
  "A festive cotton kurta for Diwali, UGC reels for Instagram",
]

export function BriefOpener() {
  const router = useRouter()
  const toast = useToast()

  const [message, setMessage] = useState("")
  const [websiteUrl, setWebsiteUrl] = useState("")
  const [sending, setSending] = useState(false)
  const [photos, setPhotos] = useState<Array<{ file: File; preview: string }>>([])
  const input = useRef<HTMLInputElement>(null)

  // Preview URLs are released when a photo is removed and when the screen goes away.
  const previews = useRef<string[]>([])
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), [])

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    const room = MAX_PHOTOS - photos.length
    const chosen = [...files].filter((file) => file.type.startsWith("image/")).slice(0, room)
    if (files.length > room) toast({ tone: "info", title: `Up to ${MAX_PHOTOS} photos`, description: "The first ones were kept." })
    const shrunk = await Promise.all(chosen.map(shrink))
    const added = shrunk.map((file) => ({ file, preview: URL.createObjectURL(file) }))
    previews.current.push(...added.map((photo) => photo.preview))
    setPhotos((current) => [...current, ...added].slice(0, MAX_PHOTOS))
  }

  async function start() {
    const trimmed = message.trim()
    if (trimmed.length < 2) return

    setSending(true)
    try {
      let response: Response
      if (photos.length) {
        const form = new FormData()
        form.set("message", trimmed)
        if (websiteUrl.trim()) form.set("websiteUrl", websiteUrl.trim())
        for (const photo of photos) form.append("photo", photo.file)
        response = await fetch("/api/projects/brief", { method: "POST", body: form })
      } else {
        response = await fetch("/api/projects/brief", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            // An empty string is not a URL; send the field only when it has one.
            ...(websiteUrl.trim() ? { websiteUrl: websiteUrl.trim() } : {}),
          }),
        })
      }
      const body = (await response.json().catch(() => ({}))) as { projectId?: string; error?: string; photosRejected?: number }

      if (!response.ok || !body.projectId) {
        toast({
          tone: "error",
          title: "Could not start",
          description: body.error ?? "Please try that again.",
        })
        return
      }

      if (body.photosRejected) {
        toast({ tone: "info", title: `${body.photosRejected} photo${body.photosRejected === 1 ? " was" : "s were"} not used`, description: "Too small or unreadable. You can add more on the project page." })
      }
      // Not resetting `sending`: the navigation replaces this screen, and flipping
      // the button back to idle first shows a live control for one frame.
      router.push(`/dashboard/projects/${body.projectId}`)
    } catch {
      toast({ tone: "error", title: "Could not start", description: "Check your connection and try again." })
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <BriefComposer
        label="Describe your product"
        placeholder="Tell me about the product…"
        value={message}
        onChange={setMessage}
        onSend={start}
        busy={sending}
        autoFocus
      />

      <div className="flex flex-wrap gap-2" aria-label="Examples">
        {PROMPTS.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setMessage(example)}
            className="rounded-full px-3.5 py-2 text-left text-[0.82rem] text-muted shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-500 ease-glide hover:bg-white/[0.05] hover:text-fg"
          >
            {example}
          </button>
        ))}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
        <TextField
          label="Product or brand link"
          optional
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://"
          value={websiteUrl}
          onChange={(event) => setWebsiteUrl(event.target.value)}
          leading={<Globe size={17} weight="light" aria-hidden="true" />}
          hint="A product page gives the exact name, details and photos. Some stores (Amazon) block reading: add photos too and nothing is lost."
        />
        </div>

        <div className="min-w-0">
          <p className="text-[0.85rem] text-fg">
            Product photos <span className="text-faint">(optional)</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {photos.map((photo, index) => (
              <div key={photo.preview} className="relative size-16 overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_var(--line)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.preview} alt={`Product photo ${index + 1}`} className="size-full object-cover" />
                <button
                  type="button"
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() => {
                    URL.revokeObjectURL(photo.preview)
                    setPhotos((current) => current.filter((_, position) => position !== index))
                  }}
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/70 text-white"
                >
                  <X size={12} weight="bold" aria-hidden="true" />
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <button
                type="button"
                onClick={() => input.current?.click()}
                disabled={sending}
                className="grid size-16 place-items-center rounded-xl border border-dashed border-[var(--line)] text-muted transition hover:bg-white/[0.04] hover:text-fg"
                aria-label="Add product photos"
              >
                <Camera size={20} weight="light" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            hidden
            onChange={(event) => {
              void addPhotos(event.target.files)
              event.target.value = ""
            }}
          />
          <p className="mt-2 text-[0.78rem] leading-snug text-muted">
            Front, back and close-ups. Every image and video keeps this exact product: same print, colours and shape.
          </p>
        </div>
      </div>
    </div>
  )
}
