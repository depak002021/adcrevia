"use client"

import { useState, type FormEvent } from "react"
import { CheckCircle2, KeyRound, Send } from "lucide-react"

import type { EmailStatus } from "@/features/admin/email/service"

/**
 * Connecting a mailbox (Admin → Email).
 *
 * The password / API key field is always blank on load: a saved secret is never sent
 * to a browser, so saving asks for it again — the same trade the storage form makes.
 *
 * "Send test email" with every field filled in tests the details as entered, before
 * saving; with the secret left blank it tests what is already saved.
 */
export function EmailForm({ initial }: { initial: EmailStatus }) {
  const [status, setStatus] = useState(initial)
  const [transport, setTransport] = useState<"smtp" | "resend">(initial.transport)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | "test" | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The clicked button, not `elements.namedItem("intent")`: with two buttons sharing
    // a name that returns a RadioNodeList whose value is always "".
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const intent = submitter?.value === "test" ? "test" : "save"
    const body = Object.fromEntries(new FormData(event.currentTarget).entries())

    setBusy(intent)
    setFields({})
    setMessage(null)

    try {
      const response = await fetch(intent === "test" ? "/api/admin/email/test" : "/api/admin/email", {
        method: intent === "test" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        email?: EmailStatus
        error?: string
        fields?: Record<string, string>
      }

      if (!response.ok) {
        setFields(payload.fields ?? {})
        setMessage(payload.error ?? "That did not save.")
        return
      }

      if (payload.email) setStatus(payload.email)
      setMessage(
        intent === "test"
          ? (payload.email?.safeTestMessage ?? "Tested.")
          : "Saved. Password-reset and other emails now use this mailbox.",
      )
    } catch {
      setMessage("The request could not be sent.")
    } finally {
      setBusy(null)
    }
  }

  const smtp = transport === "smtp"

  return (
    <form className="provider-form" onSubmit={submit}>
      <div className="provider-readiness">
        <span>
          Configured <b data-ok={status.configured ? "" : undefined}>{status.configured ? `Yes · ${status.source}` : "No"}</b>
        </span>
        <span>
          Sending as <b>{status.fromAddress || "—"}</b>
        </span>
        <span>
          Last test{" "}
          <b>
            {status.lastTestedAt
              ? `${status.lastTestSucceeded ? "Passed" : "Failed"} · ${new Date(status.lastTestedAt).toLocaleString()}`
              : "Never"}
          </b>
        </span>
      </div>

      <label>
        Delivery method
        <select name="transport" value={transport} onChange={(event) => setTransport(event.target.value as "smtp" | "resend")}>
          <option value="smtp">SMTP mailbox (e.g. your domain&rsquo;s email)</option>
          <option value="resend">Resend API</option>
        </select>
      </label>

      {smtp ? (
        <>
          <div className="provider-form-row provider-form-row-port">
            <label>
              SMTP server
              <input name="host" required defaultValue={status.host} placeholder="mail.example.com" autoComplete="off" />
              {fields.host ? <small role="alert">{fields.host}</small> : null}
            </label>
            <label>
              Port
              <input name="port" type="number" min={1} max={65535} required defaultValue={status.port || 465} />
              {fields.port ? <small role="alert">{fields.port}</small> : <small>465 (SSL) or 587</small>}
            </label>
          </div>

          <label>
            Mailbox login
            <input name="username" required defaultValue={status.username} placeholder="admin@example.com" autoComplete="off" />
            {fields.username ? <small role="alert">{fields.username}</small> : null}
          </label>

          <label>
            <span className="field-label"><KeyRound size={14} aria-hidden /> Mailbox password</span>
            <input name="password" type="password" autoComplete="new-password" placeholder="Enter to save or test new details" />
            {fields.password ? <small role="alert">{fields.password}</small> : null}
          </label>
        </>
      ) : (
        <label>
          <span className="field-label"><KeyRound size={14} aria-hidden /> Resend API key</span>
          <input name="apiKey" type="password" autoComplete="off" placeholder="re_…" />
          {fields.apiKey ? <small role="alert">{fields.apiKey}</small> : null}
        </label>
      )}

      <div className="provider-form-row">
        <label>
          Sender address
          <input name="fromAddress" type="email" required defaultValue={status.fromAddress} placeholder="admin@example.com" />
          {fields.fromAddress ? (
            <small role="alert">{fields.fromAddress}</small>
          ) : (
            <small>Use the mailbox&rsquo;s own address, or mail may land in spam.</small>
          )}
        </label>
        <label>
          Sender name
          <input name="fromName" defaultValue={status.fromName} placeholder="Adcrevia" />
          {fields.fromName ? <small role="alert">{fields.fromName}</small> : null}
        </label>
      </div>

      <div className="provider-actions">
        <button type="submit" name="intent" value="save" className="primary-button" disabled={busy !== null}>
          <CheckCircle2 size={15} aria-hidden />
          {busy === "save" ? "Saving" : "Save email settings"}
        </button>
        <button type="submit" name="intent" value="test" className="secondary-button" disabled={busy !== null} formNoValidate>
          <Send size={15} aria-hidden />
          {busy === "test" ? "Sending" : "Send test email"}
        </button>
      </div>

      {message ? (
        <p className="provider-message" role="status">
          {message}
        </p>
      ) : null}
    </form>
  )
}
