import { StorageForm } from "@/components/admin/storage-form"
import { readStorageStatus } from "@/features/admin/storage/service"

export default async function AdminStoragePage() {
  const storage = await readStorageStatus()

  return (
    <main className="studio-page narrow-page">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Media</p>
          <h1>Storage</h1>
          <p>
            Where generated images and rendered video are kept. A bucket configured here takes
            precedence over the environment, so a rotated key or a move to a new account does not
            need a deploy.
          </p>
        </div>
      </header>

      <section className="settings-card">
        <div>
          <h2>Cloudflare R2</h2>
          <p>
            S3-compatible. The credential pair is encrypted at rest and never sent back to this
            page, which is why saving asks for both halves again.
          </p>
        </div>
        <StorageForm initial={storage} />
      </section>
    </main>
  )
}
