import Link from "next/link"

import { AuthShell } from "@/components/auth/auth-shell"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams
  return (
    <AuthShell eyebrow="Secure account" title="Choose a new password." description="Your new password will revoke existing database sessions." footer={<p>Need another link? <Link href="/forgot-password">Start again</Link></p>}>
      <ResetPasswordForm token={token} />
    </AuthShell>
  )
}
