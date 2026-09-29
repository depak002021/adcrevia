"use client"

import { FormEvent, useState } from "react"

export function ForgotPasswordForm() {
  const [state, setState] = useState<"idle" | "pending" | "sent">("idle")
  const [error, setError] = useState("")

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState("pending")
    setError("")
    const form = new FormData(event.currentTarget)
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email") }),
    })
    const body = (await response.json()) as { error?: string }
    if (!response.ok) {
      setState("idle")
      setError(body.error ?? "We couldn’t send the reset email.")
      return
    }
    setState("sent")
  }

  if (state === "sent") return <div className="auth-success" role="status">If that account exists, a secure reset link is on its way.</div>
  return (
    <form className="auth-form" onSubmit={onSubmit} aria-describedby="forgot-error">
      <label htmlFor="email">Email address</label>
      <input id="email" name="email" type="email" autoComplete="email" required />
      <p id="forgot-error" className="form-error" aria-live="polite">{error}</p>
      <button className="primary-button auth-submit" type="submit" disabled={state === "pending"}>
        {state === "pending" ? "Sending secure link…" : "Send reset link"}
      </button>
    </form>
  )
}
