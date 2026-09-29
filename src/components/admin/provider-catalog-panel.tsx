"use client"

import { FormEvent, useEffect, useState } from "react"
import { CheckCircle2, KeyRound, PlugZap } from "lucide-react"

import { Reveal } from "@/components/ui/reveal"

type CatalogProviderStatus = {
  provider: string
  label: string
  emoji: string
  status: "live" | "planned"
  apiKeyEnvVar: string
  apiKeyPlaceholder: string
  docsUrl?: string
  models: { id: string; label: string; hint?: string }[]
  hasKey: boolean
}

/**
 * Super-admin panel that lists every catalog provider for a kind and lets the
 * operator save an API key for each — including providers whose generation
 * adapter is not built yet ("Coming soon"). Keys are encrypted server-side and
 * never displayed again.
 */
export function ProviderCatalogPanel({ kind }: { kind: "IMAGE" | "VIDEO" }) {
  const [providers, setProviders] = useState<CatalogProviderStatus[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const response = await fetch(`/api/admin/providers/catalog?kind=${kind}`)
    if (response.ok) {
      const body = (await response.json()) as { providers: CatalogProviderStatus[] }
      setProviders(body.providers)
    }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  if (loading) {
    return <div className="catalog-panel">{Array.from({ length: 3 }, (_, i) => <span key={i} className="shimmer-line" style={{ height: "5rem", borderRadius: "1rem" }} />)}</div>
  }

  return (
    <div className="catalog-panel">
      {/* Reveal delays are seconds (GSAP-native), not milliseconds. */}
      {providers.map((provider, index) => (
        <Reveal key={provider.provider} delay={index * 0.07}>
          <CatalogProviderRow kind={kind} provider={provider} onSaved={load} />
        </Reveal>
      ))}
    </div>
  )
}

function CatalogProviderRow({ kind, provider, onSaved }: { kind: "IMAGE" | "VIDEO"; provider: CatalogProviderStatus; onSaved: () => void }) {
  const [status, setStatus] = useState("")
  const [pending, setPending] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  // A free, read-only check of the saved key (see features/admin/providers/key-test.ts).
  async function testKey() {
    setTesting(true)
    setTest(null)
    const response = await fetch("/api/admin/providers/catalog/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, provider: provider.provider }),
    }).catch(() => null)
    const body = ((await response?.json().catch(() => null)) ?? null) as { ok?: boolean; message?: string; error?: string } | null
    setTest({ ok: Boolean(body?.ok), message: body?.message ?? body?.error ?? "The check could not run." })
    setTesting(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setStatus("")
    const apiKey = String(new FormData(event.currentTarget).get("apiKey") ?? "")
    const response = await fetch("/api/admin/providers/catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, provider: provider.provider, apiKey }),
    })
    setPending(false)
    if (response.ok) { setStatus("saved"); onSaved() } else {
      const body = await response.json().catch(() => ({}))
      setStatus((body as { error?: string }).error ?? "Could not save the key.")
    }
  }

  return (
    <section className="catalog-provider" data-status={provider.status}>
      <header>
        <div className="provider-icon" aria-hidden><span className="catalog-emoji">{provider.emoji}</span></div>
        <div>
          <p className="eyebrow">
            {kind.toLowerCase()} · {provider.status === "live" ? "supported" : "coming soon"}
            {provider.hasKey ? <span className="catalog-key-badge"><CheckCircle2 size={12} /> key on file</span> : null}
          </p>
          <h3>{provider.label}</h3>
        </div>
        {provider.status === "live" ? <span className="provider-state live"><PlugZap size={13} /> Live</span> : <span className="provider-state planned">Planned</span>}
      </header>

      <p className="catalog-models">{provider.models.map((model) => model.label).join(" · ")}</p>

      <form onSubmit={submit} className="catalog-key-form">
        <label className="catalog-key-label">
          <KeyRound size={14} /> {provider.apiKeyEnvVar}
          <input name="apiKey" type="password" placeholder={provider.apiKeyPlaceholder} minLength={8} maxLength={400} required autoComplete="off" />
        </label>
        <button className="secondary-button" disabled={pending}>{pending ? "Saving…" : provider.hasKey ? "Replace key" : "Save key"}</button>
      </form>
      {provider.hasKey && provider.status === "live" ? (
        <button type="button" className="secondary-button catalog-test" onClick={testKey} disabled={testing}>
          {testing ? "Checking…" : "Test key (free)"}
        </button>
      ) : null}
      {test ? <p className={`catalog-key-status ${test.ok ? "ok" : "err"}`}>{test.ok ? "✅" : "⚠️"} {test.message}</p> : null}

      {status === "saved" ? <p className="catalog-key-status ok">✅ Saved securely. The key is encrypted and never shown again.</p> : status ? <p className="catalog-key-status err">{status}</p> : null}
      {provider.docsUrl ? <a className="catalog-docs" href={provider.docsUrl} target="_blank" rel="noreferrer noopener">Get an API key ↗</a> : null}
    </section>
  )
}
