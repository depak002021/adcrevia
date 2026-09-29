"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, CircleNotch, X } from "@phosphor-icons/react/dist/ssr"

import { Eyebrow } from "@/components/ui/eyebrow"
import { useToast } from "@/components/ui/toast"

type Photos = { uploaded: string[]; fromWebsite: string[]; max: number }

/**
 * The real product every concept and video must keep.
 *
 * Shows the photos the generators receive (uploaded first, then those copied from the
 * product page) and lets the user add their own — the dependable route when a store
 * blocks automated reading, and the better one when the seller has their own shots.
 */
export function ProductPhotos({ projectId, disabled, refreshKey }: { projectId: string; disabled?: boolean; /** Changes when the link has been read, so its photos appear. */ refreshKey?: string }) {
  const [photos, setPhotos] = useState<Photos | null>(null)
  const [uploading, setUploading] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()

  useEffect(() => {
    let cancelled = false
    fetch(`/api/projects/${projectId}/product-photos`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: Photos | null) => {
        if (!cancelled && body) setPhotos(body)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey])

  async function upload(files: FileList | null) {
    if (!files?.length) return
    // One request per photo: each stays well under the upload limit, and one bad
    // file does not lose the others.
    for (const file of Array.from(files)) {
      setUploading((count) => count + 1)
      const form = new FormData()
      form.append("photo", file)
      const response = await fetch(`/api/projects/${projectId}/product-photos`, { method: "POST", body: form }).catch(() => null)
      const body = (await response?.json().catch(() => null)) as (Photos & { error?: string }) | null
      setUploading((count) => count - 1)
      if (response?.ok && body) setPhotos(body)
      else toast({ tone: "error", title: "Photo not added", description: body?.error ?? `${file.name} could not be uploaded.` })
    }
    if (input.current) input.current.value = ""
  }

  async function remove(url: string) {
    const response = await fetch(`/api/projects/${projectId}/product-photos`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }).catch(() => null)
    if (response?.ok) setPhotos(await response.json())
  }

  const all = photos
    ? [
        ...photos.uploaded.map((url) => ({ url, uploaded: true })),
        ...photos.fromWebsite.filter((url) => !photos.uploaded.includes(url)).map((url) => ({ url, uploaded: false })),
      ]
    : []
  const canAdd = photos ? photos.uploaded.length < photos.max : false

  return (
    <section className="mt-10 rounded-[1.2rem] p-5 shadow-[inset_0_0_0_1px_var(--line-soft)] sm:p-6">
      <Eyebrow>Product photos</Eyebrow>
      <p className="mt-2 max-w-[60ch] text-[0.88rem] leading-relaxed text-muted">
        The real product every image and video keeps: same print, colours and shape. Add your own shots (front,
        back, details), especially when the store link cannot be read.
      </p>

      <ul className="mt-4 flex flex-wrap gap-3">
        {all.map((photo) => (
          <li
            key={photo.url}
            className="relative size-24 overflow-hidden rounded-xl bg-ink-3 shadow-[inset_0_0_0_1px_var(--line-soft)] sm:size-28"
          >
            <img src={photo.url} alt="Product photo" className="size-full object-cover" loading="lazy" />
            <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 py-0.5 text-[0.62rem] text-white">
              {photo.uploaded ? "Yours" : "From page"}
            </span>
            {photo.uploaded && !disabled ? (
              <button
                type="button"
                onClick={() => remove(photo.url)}
                aria-label="Remove this photo"
                className="absolute top-1 right-1 grid size-7 place-items-center rounded-full bg-black/65 text-white transition hover:bg-black/85"
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
        {Array.from({ length: uploading }, (_, index) => (
          <li
            key={`uploading-${index}`}
            className="grid size-24 place-items-center rounded-xl bg-white/[0.04] sm:size-28"
            aria-label="Uploading"
          >
            <CircleNotch size={20} className="animate-spin text-muted" aria-hidden="true" />
          </li>
        ))}
        {photos && canAdd && !disabled ? (
          <li>
            <label className="grid size-24 cursor-pointer place-items-center rounded-xl border border-dashed border-[var(--line)] text-center text-[0.72rem] text-muted transition hover:bg-white/[0.04] sm:size-28">
              <span className="flex flex-col items-center gap-1.5">
                <Camera size={20} aria-hidden="true" />
                Add photos
              </span>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                className="sr-only"
                onChange={(event) => upload(event.target.files)}
              />
            </label>
          </li>
        ) : null}
      </ul>
      {photos && all.length === 0 ? (
        <p className="mt-3 text-[0.8rem] text-muted">No product photo yet: images will follow the written brief only.</p>
      ) : null}
    </section>
  )
}
