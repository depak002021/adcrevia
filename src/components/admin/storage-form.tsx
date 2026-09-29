"use client"

import { useState, type FormEvent } from "react"
import { CheckCircle2, KeyRound, PlugZap } from "lucide-react"

import type { StorageStatus } from "@/features/admin/storage/service"

/**
 * Connecting a bucket.
 *
 * The secret fields are always blank on load and never populated from the server, even
 * masked: a saved credential is never sent to a browser, so there is nothing to
 * populate them with. Saving therefore requires re-entering both halves of the pair,
 * which is the correct trade — a console that could show a secret back is a console that
 * leaks one.
 *
 * Testing writes and deletes a real object. A read-only check would pass with
 * credentials that cannot write, which is the only permission this provider ever uses.
 */
export function StorageForm({ initial }: { initial: StorageStatus }) {
  const [status, setStatus] = useState(initial)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | "test" | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    // The clicked button. `form.elements.namedItem("intent")` returns a RadioNodeList
    // when two buttons share the name, and its `.value` is always "" for buttons — so
    // "Test upload" used to fall through to a save.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const intent = submitter?.value === "test" ? "test" : "save"
    const body = Object.fromEntries(new FormData(form).entries())

    setBusy(intent === "test" ? "test" : "save")
    setFields({})
    setMessage(null)

    try {
      const response = await fetch(intent === "test" ? "/api/admin/storage/test" : "/api/admin/storage", {
        method: intent === "test" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        storage?: StorageStatus
        error?: string
        fields?: Record<string, string>
      }

      if (!response.ok) {
        setFields(payload.fields ?? {})
        setMessage(payload.error ?? "That did not save.")
        return
      }

      if (payload.storage) setStatus(payload.storage)
      setMessage(
        intent === "test"
          ? (payload.storage?.safeTestMessage ?? "Tested.")
          : "Saved. New uploads go to this bucket.",
      )
    } catch {
      setMessage("The request could not be sent.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <form className="provider-form" onSubmit={submit}>
      <div className="provider-readiness">
        <span>
          Configured <b>{status.configured ? `Yes · ${status.source}` : "No"}</b>
        </span>
        <span>
          Bucket <b>{status.bucket || "—"}</b>
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
        S3 endpoint
        <input
          name="endpoint"
          type="url"
          required
          defaultValue={status.endpoint}
          placeholder="https://ACCOUNT_ID.r2.cloudflarestorage.com"
        />
        {fields.endpoint ? <small role="alert">{fields.endpoint}</small> : null}
      </label>

      <label>
        Bucket
        <input name="bucket" required defaultValue={status.bucket} placeholder="adcrevia-media" />
        {fields.bucket ? <small role="alert">{fields.bucket}</small> : null}
      </label>

      <label>
        Public base URL
        <input
          name="publicBaseUrl"
          type="url"
          required
          defaultValue={status.publicBaseUrl}
          placeholder="https://media.example.com"
        />
        {fields.publicBaseUrl ? <small role="alert">{fields.publicBaseUrl}</small> : null}
      </label>

      <label>
        <span className="field-label"><KeyRound size={14} aria-hidden /> Access key ID</span>
        {/*
          `autoComplete="off"` and `type="password"` on both halves: a browser offering
          to save an R2 key pair into a personal password manager is not a prompt an
          operator should be given.
        */}
        <input name="accessKeyId" type="password" required autoComplete="off" placeholder="Enter to change" />
        {fields.accessKeyId ? <small role="alert">{fields.accessKeyId}</small> : null}
      </label>

      <label>
        <span className="field-label"><KeyRound size={14} aria-hidden /> Secret access key</span>
        <input name="secretAccessKey" type="password" required autoComplete="off" placeholder="Enter to change" />
        {fields.secretAccessKey ? <small role="alert">{fields.secretAccessKey}</small> : null}
      </label>

      <div className="provider-actions">
        <button type="submit" name="intent" value="save" className="primary-button" disabled={busy !== null}>
          <CheckCircle2 size={15} aria-hidden />
          {busy === "save" ? "Saving" : "Save bucket"}
        </button>
        <button type="submit" name="intent" value="test" className="secondary-button" disabled={busy !== null} formNoValidate>
          <PlugZap size={15} aria-hidden />
          {busy === "test" ? "Testing" : "Test upload"}
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
