import { BflProviderCard } from "@/components/admin/bfl-provider-card"

export default function FluxProvidersPage() {
  return (
    <main className="studio-page narrow-page">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Provider management</p>
          <h1>FLUX / BFL</h1>
          <p>Configure Black Forest Labs image and video models independently with one encrypted credential.</p>
        </div>
      </header>
      <BflProviderCard />
    </main>
  )
}
