import { ProviderCatalogPanel } from "@/components/admin/provider-catalog-panel"

export default function VideoProvidersPage() {
  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">Video providers</p>
          <h1 className="gradient-heading">Connect your video models 🎬</h1>
          <p>Save an API key for any provider below. Supported providers generate immediately; others are captured for when their adapter ships. Saved keys are encrypted and never displayed again.</p>
        </div>
      </header>
      <ProviderCatalogPanel kind="VIDEO" />
    </main>
  )
}
