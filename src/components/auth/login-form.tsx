"use client"

import { FormEvent, useState } from "react"
import Link from "next/link"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

export function LoginForm({ admin = false }: { admin?: boolean }) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setPending(true)
    const form = new FormData(event.currentTarget)
    const result = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirect: false,
    })
    setPending(false)
    if (!result?.ok) {
      setError("That email and password combination wasn’t recognized.")
      return
    }
    router.push(admin ? "/admin" : "/dashboard")
    router.refresh()
  }

  return (
    <form className="auth-form" onSubmit={onSubmit} aria-describedby="login-error">
      <label htmlFor="email">Email address</label>
      <input id="email" name="email" type="email" autoComplete="email" required />
      <div className="label-row">
        <label htmlFor="password">Password</label>
        {!admin ? <Link href="/forgot-password">Forgot password?</Link> : null}
      </div>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      <p id="login-error" className="form-error" aria-live="polite">{error}</p>
      <button className="primary-button auth-submit" type="submit" disabled={pending}>
        {pending ? "Signing in…" : admin ? "Enter admin studio" : "Enter the studio"}
      </button>
    </form>
  )
}
