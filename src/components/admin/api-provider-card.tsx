"use client"

import { FormEvent, useState } from "react"
import { CheckCircle2, KeyRound, PlugZap } from "lucide-react"

export function ApiProviderCard({ kind, provider, defaultModel }: { kind: "IMAGE" | "VIDEO"; provider: "OPENAI" | "RUNWAY"; defaultModel: string }) {
  const [status, setStatus] = useState("")
  const [pending, setPending] = useState(false)

  function payload(form: HTMLFormElement) {
    const data = new FormData(form)
    return { kind, provider, model: data.get("model"), endpoint: data.get("endpoint"), apiKey: data.get("apiKey"), enabled: true }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setStatus("")
    const response = await fetch("/api/admin/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(event.currentTarget)) })
    setPending(false); setStatus(response.ok ? "Encrypted and saved. This provider is active." : "Provider settings could not be saved.")
  }

  async function testConnection(form: HTMLFormElement) {
    setPending(true); setStatus("")
    const response = await fetch("/api/admin/providers/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(form)) })
    const body = await response.json() as { ok?: boolean; category?: string; error?: string }
    setPending(false); setStatus(body.ok ? "Connection verified." : body.error ?? `Connection failed: ${body.category?.toLowerCase().replaceAll("_", " ")}.`)
  }

  return <section className="provider-card"><header><div className="provider-icon"><PlugZap /></div><div><p className="eyebrow">{kind.toLowerCase()} intelligence</p><h2>{provider === "OPENAI" ? "OpenAI" : "Runway"}</h2></div><span className="provider-state">Configuration</span></header><form onSubmit={submit}><label>Model<input name="model" defaultValue={defaultModel} required /></label><label>Custom endpoint <span>Optional</span><input name="endpoint" type="url" placeholder="Use provider default" /></label><label>API key<div className="secret-input"><KeyRound /><input name="apiKey" type="password" autoComplete="new-password" minLength={16} placeholder="••••••••••••" required /></div></label><div className="provider-actions"><button type="button" className="secondary-button" disabled={pending} onClick={(event) => testConnection(event.currentTarget.form!)}>Test connection</button><button className="primary-button" disabled={pending}>{pending ? "Working…" : "Save encrypted key"}</button></div><p aria-live="polite" className="provider-message">{status ? <><CheckCircle2 size={14} />{status}</> : "Credentials are encrypted before database storage."}</p></form></section>
}
