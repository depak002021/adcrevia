import Link from "next/link"

import { GenerationLogTable } from "@/components/admin/generation-log-table"
import { onePerGeneration, listGenerationLogs } from "@/features/admin/logs/service"
import { overallSpend } from "@/features/costs/service"

const usd = (value: number) => `$${value.toFixed(2)}`

export default async function AdminLogsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams
  const selected = kind === "VIDEO" ? "VIDEO" : "IMAGE"
  const [logs, spend] = await Promise.all([listGenerationLogs(selected), overallSpend()])
  const rows = onePerGeneration(logs)

  return (
    <main className="studio-page">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Spend and activity</p>
          <h1>Generation logs</h1>
          <p>Every image and video, what it cost and how long it took. Costs come from each provider&rsquo;s own figures; credentials and raw responses are never stored.</p>
        </div>
      </header>

      <section className="spend-summary" aria-label="Spend">
        <article><p>Total spend</p><strong>{usd(spend.totalUsd)}</strong><span>{spend.images.count + spend.videos.count} finished generations</span></article>
        <article><p>Images</p><strong>{usd(spend.images.usd)}</strong><span>{spend.images.count} images</span></article>
        <article><p>Videos</p><strong>{usd(spend.videos.usd)}</strong><span>{spend.videos.count} videos and clips</span></article>
        <article>
          <p>By provider</p>
          <ul>{spend.byProvider.length ? spend.byProvider.map((item) => <li key={item.provider}><span>{item.provider}</span><b>{usd(item.usd)}</b></li>) : <li><span>No spend yet</span></li>}</ul>
        </article>
      </section>
      {spend.unpriced ? (
        <p className="spend-note">{spend.unpriced} earlier generation{spend.unpriced === 1 ? " was" : "s were"} made before costs were recorded and {spend.unpriced === 1 ? "is" : "are"} not included in these totals.</p>
      ) : null}
      {spend.byProject.length ? (
        <section className="spend-projects" aria-label="Spend by project">
          <h2>By project</h2>
          <ul>{spend.byProject.slice(0, 8).map((project) => <li key={project.projectId}><span>{project.name}</span><b>{usd(project.usd)}</b></li>)}</ul>
        </section>
      ) : null}

      <nav className="admin-tabs" aria-label="Generation log type">
        <Link href="/admin/logs?kind=IMAGE" aria-current={selected === "IMAGE" ? "page" : undefined}>Image logs</Link>
        <Link href="/admin/logs?kind=VIDEO" aria-current={selected === "VIDEO" ? "page" : undefined}>Video logs</Link>
      </nav>
      <GenerationLogTable rows={rows} />
    </main>
  )
}
