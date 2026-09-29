"use client"

import { useState } from "react"

/** One on/off system setting, saved through its admin endpoint. */
export function SettingSwitch({
  endpoint,
  initialOn,
  onText,
  offText,
  turnOn,
  turnOff,
}: {
  endpoint: string
  initialOn: boolean
  onText: string
  offText: string
  turnOn: string
  turnOff: string
}) {
  const [on, setOn] = useState(initialOn)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  async function change(next: boolean) {
    setPending(true)
    setError("")
    const response = await fetch(endpoint, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ open: next }) })
    const body = (await response.json().catch(() => null)) as { open?: boolean; error?: string } | null
    setPending(false)
    if (response.ok && typeof body?.open === "boolean") setOn(body.open)
    else setError(body?.error ?? "The setting could not be saved.")
  }

  return (
    <div className="settings-form">
      <p>{on ? onText : offText}</p>
      <button className={on ? "secondary-button" : "primary-button"} type="button" disabled={pending} onClick={() => change(!on)}>
        {pending ? "Saving…" : on ? turnOff : turnOn}
      </button>
      <p aria-live="polite">{error}</p>
    </div>
  )
}
