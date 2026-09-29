"use client"

import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"

/**
 * Create an account for someone (sign-up is closed during the POC). The admin sets
 * a starting password and shares it; the person can change it with "Forgot
 * password" once email is configured.
 */
export function CreateUserForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setPending(true)
    setStatus("")
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
        role: form.get("role"),
      }),
    })
    const body = (await response.json().catch(() => null)) as { user?: { email: string }; error?: string } | null
    setPending(false)
    if (response.ok && body?.user) {
      setStatus(`Account created for ${body.user.email}. Share the password with them securely.`)
      formElement.reset()
      router.refresh()
    } else {
      setStatus(body?.error ?? "The account could not be created.")
    }
  }

  return (
    <form className="create-user-form" onSubmit={submit}>
      <h2>Create an account</h2>
      <div className="create-user-grid">
        <label>Name<input id="new-user-name" name="name" minLength={2} maxLength={80} required autoComplete="off" /></label>
        <label>Email<input id="new-user-email" name="email" type="email" maxLength={254} required autoComplete="off" /></label>
        <label>Starting password<input id="new-user-password" name="password" type="text" minLength={12} maxLength={128} required autoComplete="new-password" placeholder="At least 12 characters" /></label>
        <label>Role<select id="new-user-role" name="role" defaultValue="USER"><option value="USER">Studio user</option><option value="SUPER_ADMIN">Super admin</option></select></label>
      </div>
      <button className="primary-button" type="submit" disabled={pending}>{pending ? "Creating…" : "Create account"}</button>
      <p aria-live="polite">{status}</p>
    </form>
  )
}
