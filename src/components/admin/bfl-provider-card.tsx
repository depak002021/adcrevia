"use client"

import { type FormEvent, useState } from "react"
import { CheckCircle2, KeyRound, PlugZap } from "lucide-react"

function payload(form: HTMLFormElement) {
  const data = new FormData(form)
  return {
    apiKey: data.get("apiKey"),
    imageModel: data.get("imageModel"),
    videoModel: data.get("videoModel"),
    imageEnabled: data.get("imageEnabled") === "on",
    videoEnabled: data.get("videoEnabled") === "on",
  }
}

export function BflProviderCard() {
  const [status, setStatus] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setStatus("")
    const response = await fetch("/api/admin/providers/bfl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload(event.currentTarget)),
    })
    setPending(false)
    setStatus(response.ok ? "Both encrypted BFL configurations were saved." : "BFL settings could not be saved.")
  }

  async function testConnection(form: HTMLFormElement) {
    setPending(true)
    setStatus("")
    const response = await fetch("/api/admin/providers/bfl/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: new FormData(form).get("apiKey") }),
    })
    const body = await response.json() as { ok?: boolean; category?: string; error?: string }
    setPending(false)
    setStatus(body.ok ? "Connection verified." : body.error ?? `Connection failed: ${body.category?.toLowerCase().replaceAll("_", " ")}.`)
  }

  return (
    <section className="provider-card">
      <header>
        <div className="provider-icon"><PlugZap /></div>
        <div><p className="eyebrow">Image and video intelligence</p><h2>Black Forest Labs</h2></div>
        <span className="provider-state">Dual configuration</span>
      </header>
      <form onSubmit={submit}>
        <label>Image model<input name="imageModel" defaultValue="flux-2-pro" required pattern="[a-z0-9.-]+" /></label>
        <label className="provider-checkbox"><input name="imageEnabled" type="checkbox" defaultChecked /> Use BFL for image generation</label>
        <label>Video model<input name="videoModel" defaultValue="flux-3-video" required pattern="[a-z0-9.-]+" /></label>
        <label className="provider-checkbox"><input name="videoEnabled" type="checkbox" defaultChecked /> Use BFL for video generation</label>
        <label>API key<div className="secret-input"><KeyRound /><input name="apiKey" type="password" autoComplete="new-password" minLength={16} placeholder="••••••••••••" required /></div></label>
        <div className="provider-actions">
          <button type="button" className="secondary-button" disabled={pending} onClick={(event) => testConnection(event.currentTarget.form!)}>Test connection</button>
          <button className="primary-button" disabled={pending}>{pending ? "Working…" : "Save encrypted key"}</button>
        </div>
        <p aria-live="polite" className="provider-message">{status ? <><CheckCircle2 size={14} />{status}</> : "One key is encrypted separately for the image and video configurations."}</p>
      </form>
    </section>
  )
}
