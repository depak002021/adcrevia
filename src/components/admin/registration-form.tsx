"use client"

import { useState } from "react"

/** Open or close public sign-up. Closed by default during the POC. */
export function RegistrationForm({ initialOpen }: { initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState("")

  async function change(next: boolean) {
    setPending(true)
    setStatus("")
    const response = await fetch("/api/admin/settings/registration", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ open: next }),
    })
    const body = (await response.json().catch(() => null)) as { open?: boolean; error?: string } | null
    setPending(false)
    if (response.ok && typeof body?.open === "boolean") {
      setOpen(body.open)
      setStatus(body.open ? "Sign-up is open: anyone with the link can create an account." : "Sign-up is closed: only admins create accounts.")
    } else {
      setStatus(body?.error ?? "The setting could not be saved.")
    }
  }

  return (
    <div className="settings-form">
      <p>
        Public sign-up is <b>{open ? "open" : "closed"}</b>.{" "}
        {open ? "Anyone can create an account at /register." : "Only admins create accounts, in Admin → Users."}
      </p>
      <button className={open ? "secondary-button" : "primary-button"} type="button" disabled={pending} onClick={() => change(!open)}>
        {pending ? "Saving…" : open ? "Close sign-up" : "Open sign-up"}
      </button>
      <p aria-live="polite">{status}</p>
    </div>
  )
}
