import Link from "next/link"

import { AuthShell } from "@/components/auth/auth-shell"
import { LoginForm } from "@/components/auth/login-form"
import { isRegistrationOpen } from "@/features/auth/registration"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  const open = await isRegistrationOpen()
  return (
    <AuthShell
      eyebrow="Creative access"
      title="Welcome back."
      description="Return to your product stories, generated assets, and campaign workspace."
      footer={open ? <p>New to Adcrevia? <Link href="/register">Create an account</Link></p> : <p>Invite-only preview. Accounts are created by your administrator.</p>}
    >
      <LoginForm />
    </AuthShell>
  )
}
