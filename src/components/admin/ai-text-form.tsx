"use client"

import { useState, type FormEvent } from "react"
import { CheckCircle2, KeyRound, Trash2 } from "lucide-react"

import type { AiTextStatus } from "@/features/admin/ai-text/service"

type Payload = { aiText?: AiTextStatus; error?: string; fields?: Record<string, string> }

const ROLES = [
  { role: "text", label: "Writing model", hint: "Creative directions, prompts and copy." },
  { role: "agent", label: "Brief assistant model", hint: "Holds the brief conversation. Must support tool calling." },
  { role: "decision", label: "Decision model", hint: "Cheap classifier for readiness and product-match checks." },
] as const

const SOURCE_LABEL = { database: "set here", environment: "from server config", default: "default" } as const

/**
 * Admin → AI text. Model ids are not secret and are shown back. The TypeSafe key is
 * write-only: it is encrypted at rest and never returned, so the field is always blank.
 */
export function AiTextForm({ initial }: { initial: AiTextStatus }) {
  const [status, setStatus] = useState(initial)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ section: "models" | "typesafe"; text: string } | null>(null)
  const [busy, setBusy] = useState<"models" | "typesafe" | "disable" | null>(null)

  async function send(section: "models" | "typesafe", url: string, method: string, body?: unknown, done?: string) {
    setFields({})
    setMessage(null)
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const payload = (await response.json().catch(() => ({}))) as Payload
      if (!response.ok) {
        setFields(payload.fields ?? {})
        setMessage({ section, text: payload.error ?? "That did not save." })
        return false
      }
      if (payload.aiText) setStatus(payload.aiText)
      setMessage({ section, text: done ?? "Saved." })
      return true
    } catch {
      setMessage({ section, text: "The request could not be sent." })
      return false
    } finally {
      setBusy(null)
    }
  }

  async function saveModels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy("models")
    await send("models", "/api/admin/ai-text", "PUT", Object.fromEntries(new FormData(event.currentTarget).entries()),
      "Saved. New requests use these models.")
  }

  async function saveTypeSafe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setBusy("typesafe")
    const ok = await send("typesafe", "/api/admin/ai-text/typesafe", "PUT", Object.fromEntries(new FormData(form).entries()),
      "Saved. The decision layer now uses TypeSafe.")
    // Clear the typed key once it is saved; it is never shown again.
    const keyInput = form.elements.namedItem("apiKey")
    if (ok && keyInput instanceof HTMLInputElement) keyInput.value = ""
  }

  async function disableTypeSafe() {
    setBusy("disable")
    await send("typesafe", "/api/admin/ai-text/typesafe", "DELETE", undefined, "TypeSafe disabled. Decisions use OpenAI.")
  }

  return (
    <>
      <section className="settings-card">
        <div>
          <h2>OpenAI models</h2>
          <p>
            The OpenAI key itself is set under Image providers → OpenAI. Leave a field blank to use the
            server&rsquo;s default.
          </p>
        </div>
        <form className="provider-form" onSubmit={saveModels}>
          {ROLES.map(({ role, label, hint }) => (
            <label key={role}>
              {label}
              <input
                name={role}
                defaultValue={status.saved[role]}
                placeholder={status.models[role].value}
                autoComplete="off"
                spellCheck={false}
              />
              {fields[role] ? (
                <small role="alert">{fields[role]}</small>
              ) : (
                <small>
                  {hint} In use: <b>{status.models[role].value}</b> ({SOURCE_LABEL[status.models[role].source]})
                </small>
              )}
            </label>
          ))}
          <div className="provider-actions">
            <button type="submit" className="primary-button" disabled={busy !== null}>
              <CheckCircle2 size={15} aria-hidden />
              {busy === "models" ? "Saving" : "Save models"}
            </button>
          </div>
          {message?.section === "models" ? <p className="provider-message" role="status">{message.text}</p> : null}
        </form>
      </section>

      <section className="settings-card">
        <div>
          <h2>Decision backend</h2>
          <p>
            Optional. With a TypeSafe Jev key saved, the decision layer uses it (faster and cheaper per
            judgement); without one it uses OpenAI, which works fine. Keys come from{" "}
            <a href="https://console.typesafe.ai/settings/keys" target="_blank" rel="noreferrer">
              console.typesafe.ai
            </a>{" "}
            (early access is by waitlist).
          </p>
        </div>
        <form className="provider-form" onSubmit={saveTypeSafe}>
          <div className="provider-readiness">
            <span>
              Answering{" "}
              <b data-ok={status.decisions.configured ? "" : undefined}>
                {status.decisions.provider === "typesafe" ? "TypeSafe Jev" : "OpenAI"}
                {status.decisions.source === "none" ? " · not configured" : ` · ${status.decisions.source}`}
              </b>
            </span>
            <span>
              TypeSafe key <b>{status.typesafe.configured ? "Saved" : "Not saved"}</b>
            </span>
          </div>
          <label>
            <span className="field-label"><KeyRound size={14} aria-hidden /> TypeSafe API key</span>
            <input name="apiKey" type="password" required autoComplete="off" placeholder="Enter to save or replace" />
            {fields.apiKey ? <small role="alert">{fields.apiKey}</small> : null}
          </label>
          <div className="provider-form-row">
            <label>
              Model (optional)
              <input name="model" defaultValue={status.typesafe.model} placeholder="jev-latest" autoComplete="off" />
              {fields.model ? <small role="alert">{fields.model}</small> : null}
            </label>
            <label>
              Endpoint (optional)
              <input name="endpoint" defaultValue={status.typesafe.endpoint} placeholder="Default" autoComplete="off" />
              {fields.endpoint ? <small role="alert">{fields.endpoint}</small> : null}
            </label>
          </div>
          <div className="provider-actions">
            <button type="submit" className="primary-button" disabled={busy !== null}>
              <CheckCircle2 size={15} aria-hidden />
              {busy === "typesafe" ? "Saving" : "Save TypeSafe key"}
            </button>
            {status.typesafe.configured ? (
              <button type="button" className="secondary-button" onClick={disableTypeSafe} disabled={busy !== null}>
                <Trash2 size={15} aria-hidden />
                {busy === "disable" ? "Disabling" : "Stop using TypeSafe"}
              </button>
            ) : null}
          </div>
          {message?.section === "typesafe" ? <p className="provider-message" role="status">{message.text}</p> : null}
        </form>
      </section>
    </>
  )
}
