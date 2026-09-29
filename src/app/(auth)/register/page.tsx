import Link from "next/link"

import { AuthShell } from "@/components/auth/auth-shell"
import { RegisterForm } from "@/components/auth/register-form"
import { isRegistrationOpen } from "@/features/auth/registration"

// Reads the live setting on every visit, so opening sign-up needs no deploy.
export const dynamic = "force-dynamic"

export default async function RegisterPage() {
  if (!(await isRegistrationOpen())) {
    return (
      <AuthShell
        eyebrow="Private preview"
        title="Adcrevia is invite-only for now."
        description="Accounts are created by the Adcrevia team during the preview. If you should have access, ask your administrator for an account, then sign in."
        footer={<p>Already have an account? <Link href="/login">Sign in</Link></p>}
      >
        <Link className="primary-button" href="/login">Go to sign in</Link>
      </AuthShell>
    )
  }
  return (
    <AuthShell
      eyebrow="Start creating"
      title="Your next campaign starts here."
      description="Build a private AI studio for premium product imagery and motion."
      footer={<p>Already have an account? <Link href="/login">Sign in</Link></p>}
    >
      <RegisterForm />
    </AuthShell>
  )
}
