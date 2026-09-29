"use client"

import { FormEvent, useState } from "react"
import Link from "next/link"

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState("")

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError("")
    const form = new FormData(event.currentTarget)
    const password = String(form.get("password") ?? "")
    if (password !== form.get("confirmation")) {
      setPending(false)
      setError("Passwords do not match.")
      return
    }
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    })
    const body = (await response.json()) as { error?: string }
    setPending(false)
    if (!response.ok) {
      setError(body.error ?? "We couldn’t reset your password.")
      return
    }
    setComplete(true)
  }

  if (complete) return <div className="auth-success" role="status">Password updated. <Link href="/login">Sign in to Adcrevia</Link>.</div>
  if (!token) return <div className="auth-success auth-warning">This reset link is incomplete. Request a new link.</div>
  return (
    <form className="auth-form" onSubmit={onSubmit} aria-describedby="reset-error">
      <label htmlFor="password">New password</label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      <label htmlFor="confirmation">Confirm new password</label>
      <input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      <p className="field-hint">Use at least 12 characters.</p>
      <p id="reset-error" className="form-error" aria-live="polite">{error}</p>
      <button className="primary-button auth-submit" type="submit" disabled={pending}>
        {pending ? "Securing your account…" : "Set new password"}
      </button>
    </form>
  )
}
