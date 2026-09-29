"use client"

import { FormEvent, useState } from "react"

export function GenerationPolicyForm({ initialCount }: { initialCount: number }) {
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setStatus("")

    const form = new FormData(event.currentTarget)
    const response = await fetch("/api/admin/settings/generation", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultImageCount: Number(form.get("defaultImageCount")) }),
    })
    const body = await response.json().catch(() => null) as { error?: string } | null
    setPending(false)
    setStatus(response.ok ? "Generation policy saved." : body?.error ?? "Generation policy could not be saved.")
  }

  return <form className="settings-form" onSubmit={submit}>
    <label htmlFor="default-image-count">Default images per project</label>
    <input id="default-image-count" name="defaultImageCount" type="number" min={1} max={10} step={1} defaultValue={initialCount} required />
    <p>Applies to newly created projects only.</p>
    <button className="primary-button" type="submit" disabled={pending}>{pending ? "Saving…" : "Save policy"}</button>
    <p aria-live="polite">{status}</p>
  </form>
}
