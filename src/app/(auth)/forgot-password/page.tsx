import Link from "next/link"

import { AuthShell } from "@/components/auth/auth-shell"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export default function ForgotPasswordPage() {
  return (
    <AuthShell eyebrow="Account recovery" title="Reset your password." description="We’ll email a one-time link that expires in one hour." footer={<p>Remembered it? <Link href="/login">Return to sign in</Link></p>}>
      <ForgotPasswordForm />
    </AuthShell>
  )
}
