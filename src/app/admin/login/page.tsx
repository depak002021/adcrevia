import Link from "next/link"

import { AuthShell } from "@/components/auth/auth-shell"
import { LoginForm } from "@/components/auth/login-form"

export default function AdminLoginPage() {
  return (
    <AuthShell
      eyebrow="Restricted access"
      title="Operations console."
      description="Sign in with a Super Admin account to manage providers, users, and system health."
      footer={<p><Link href="/login">Return to user sign in</Link></p>}
    >
      <LoginForm admin />
    </AuthShell>
  )
}
