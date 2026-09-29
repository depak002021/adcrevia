"use client"

import Link from "next/link"
import { useState } from "react"
import { Copy, Download, FolderOpen, PenLine } from "lucide-react"

import { useSocialCopy } from "@/components/captions/use-social-copy"
import { ShareButton } from "@/components/compositions/share-sheet"
import { captionFor } from "@/features/captions/schema"

/**
 * A finished video and what to do with it: share it (with its caption), download
 * it, copy or write the caption, or go back to the project to make more.
 */
export function VideoPlayer({ url, projectId, videoId, downloadUrl }: { url: string; projectId: string; videoId?: string; downloadUrl?: string }) {
  // Through the app, so it saves as a named file on every browser and phone (see the download route).
  const downloadHref = downloadUrl ?? (videoId ? `/api/videos/${videoId}/download` : url)
  const captions = useSocialCopy(projectId)
  const caption = captions.copy ? captionFor(captions.copy, "instagram") : null
  const [copied, setCopied] = useState(false)

  const copyCaption = async () => {
    if (!caption) return
    try {
      await navigator.clipboard.writeText(caption)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <section className="video-result">
      <div>
        <p className="eyebrow">Render complete</p>
        <h2>Your video is ready.</h2>
        <p>Saved in your library. Share it straight to Instagram, TikTok or WhatsApp, or download it for later.</p>
      </div>
      <video src={url} controls playsInline preload="metadata">Your browser does not support video playback.</video>
      <div className="video-result-actions">
        <ShareButton url={downloadHref} publicUrl={url} label="Adcrevia video" caption={caption} />
        <a className="primary-button" href={downloadHref} download><Download size={17} /> Download video</a>
        {caption ? (
          <button type="button" className="secondary-button" onClick={copyCaption}><Copy size={17} /> {copied ? "Caption copied" : "Copy caption"}</button>
        ) : captions.loaded ? (
          <button type="button" className="secondary-button" onClick={captions.write} disabled={captions.writing}><PenLine size={17} /> {captions.writing ? "Writing captions…" : "Write captions"}</button>
        ) : null}
        <Link className="secondary-button" href={`/dashboard/projects/${projectId}`}><FolderOpen size={17} /> Open project</Link>
      </div>
      {captions.error ? <p className="workspace-message">{captions.error}</p> : null}
      {caption ? <p className="video-caption-preview">{caption}</p> : null}
    </section>
  )
}
