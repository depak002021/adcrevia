"use client"

import { FormEvent, useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

export function RegisterForm() {
  const router = useRouter()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setPending(true)
    const form = new FormData(event.currentTarget)
    const payload = {
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
    }
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    const body = (await response.json()) as { error?: string }
    if (!response.ok) {
      setPending(false)
      setError(body.error ?? "We couldn’t create your account. Please try again.")
      return
    }
    await signIn("credentials", { email: payload.email, password: payload.password, redirect: false })
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <form className="auth-form" onSubmit={onSubmit} aria-describedby="registration-error">
      <label htmlFor="name">Full name</label>
      <input id="name" name="name" autoComplete="name" minLength={2} maxLength={80} required />
      <label htmlFor="email">Email address</label>
      <input id="email" name="email" type="email" autoComplete="email" required />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      <p className="field-hint">Use at least 12 characters.</p>
      <p id="registration-error" className="form-error" aria-live="polite">{error}</p>
      <button className="primary-button auth-submit" type="submit" disabled={pending}>
        {pending ? "Creating your studio…" : "Create free account"}
      </button>
    </form>
  )
}
