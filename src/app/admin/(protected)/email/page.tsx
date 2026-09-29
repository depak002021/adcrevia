import { EmailForm } from "@/components/admin/email-form"
import { readEmailStatus } from "@/features/admin/email/service"

export default async function AdminEmailPage() {
  const email = await readEmailStatus()

  return (
    <main className="studio-page narrow-page">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Delivery</p>
          <h1>Email</h1>
          <p>
            The mailbox Adcrevia sends from: password resets and account email. A mailbox configured
            here takes precedence over the server configuration, so a changed password or a new mailbox
            does not need a deploy.
          </p>
        </div>
      </header>

      <section className="settings-card">
        <div>
          <h2>Outgoing mail</h2>
          <p>
            The password or API key is encrypted at rest and never sent back to this page, which is why
            saving asks for it again.
          </p>
        </div>
        <EmailForm initial={email} />
      </section>
    </main>
  )
}
