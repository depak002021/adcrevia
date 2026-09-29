import { Activity, CircleCheck, ImageIcon, Users, Video } from "lucide-react"

import { Counter } from "@/components/ui/counter"
import { Reveal } from "@/components/ui/reveal"
import { getAdminDashboardSummary } from "@/features/admin/dashboard/service"

const PROVIDER_LABELS: Record<string, string> = {
  "openai-image": "OpenAI",
  "bfl-image": "FLUX",
  "google-image": "Google Imagen",
  "runway-video": "Runway",
  "bfl-video": "FLUX 3 Video",
}

function providerLabel(slug: string | undefined | null) {
  if (!slug) return null
  return PROVIDER_LABELS[slug] ?? slug
}

export default async function AdminDashboardPage() {
  const summary = await getAdminDashboardSummary()
  const { readiness } = summary
  const activeImageLabel = providerLabel(readiness.activeImage?.slug)
  const activeVideoLabel = providerLabel(readiness.activeVideo?.slug)

  return (
    <main className="studio-page">
      <header className="studio-header">
        <div>
          <p className="eyebrow">System overview</p>
          <h1 className="gradient-heading">Operations console</h1>
          <p>Provider health, creative throughput, and account operations in one place.</p>
        </div>
        <span className="health-pill"><CircleCheck size={16} /> Core healthy</span>
      </header>

      <section className="metric-grid admin-metrics" aria-label="Platform totals">
        <Reveal as="article" delay={0}>
          <Users /><p>Active users</p><strong><Counter value={summary.users} /></strong><span>{summary.projects} total projects</span>
        </Reveal>
        {/* Reveal delays are seconds (GSAP-native), not milliseconds. */}
        <Reveal as="article" delay={0.08}>
          <ImageIcon /><p>Images generated</p><strong><Counter value={summary.images} /></strong><span>Stored campaign frames</span>
        </Reveal>
        <Reveal as="article" delay={0.16}>
          <Video /><p>Videos generated</p><strong><Counter value={summary.videos} /></strong><span>Stored motion studies</span>
        </Reveal>
        <Reveal as="article" delay={0.24}>
          <Activity /><p>Failed jobs</p><strong><Counter value={summary.failures} /></strong><span>Image and video jobs</span>
        </Reveal>
      </section>

      <Reveal as="section" className="settings-card" delay={0.12}>
        <div>
          <h2>Provider readiness</h2>
          <p>Live status of the credentials powering creative jobs.</p>
        </div>
        <div className="provider-readiness">
          <span>
            Image models{" "}
            <b data-ok={readiness.imageProviderCount > 0 || undefined}>
              {readiness.imageProviderCount > 0 ? `${readiness.imageProviderCount} connected` : "Not configured"}
            </b>
          </span>
          <span>
            Active image{" "}
            <b data-ok={Boolean(activeImageLabel) || undefined}>
              {activeImageLabel ? `${activeImageLabel} · ${readiness.activeImage?.model ?? "default"}` : "None active"}
            </b>
          </span>
          <span>
            Video models{" "}
            <b data-ok={readiness.videoProviderCount > 0 || undefined}>
              {readiness.videoProviderCount > 0 ? `${readiness.videoProviderCount} connected` : "Not configured"}
            </b>
          </span>
          <span>
            Active video{" "}
            <b data-ok={Boolean(activeVideoLabel) || undefined}>
              {activeVideoLabel ? `${activeVideoLabel} · ${readiness.activeVideo?.model ?? "default"}` : "None active"}
            </b>
          </span>
          <span>
            Object storage{" "}
            <b data-ok={readiness.storageConfigured || undefined}>
              {readiness.storageConfigured ? "Configured" : "Not configured"}
            </b>
          </span>
        </div>
      </Reveal>
    </main>
  )
}
