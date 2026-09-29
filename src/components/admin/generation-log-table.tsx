type LogRow = {
  id: string
  status: string
  provider: string
  model: string | null
  safeErrorCode: string | null
  correlationId: string
  createdAt: Date
  durationMs?: number | null
  details?: unknown
  projectName?: string
}

function record(details: unknown): Record<string, unknown> {
  return details && typeof details === "object" ? (details as Record<string, unknown>) : {}
}

/**
 * The cost column. An outcome row shows what was actually charged (from the
 * provider's own figures); a render still in progress shows its estimate.
 */
function cost(row: LogRow): { text: string; tone: "actual" | "estimate" | "none" } {
  const details = record(row.details)
  if (typeof details.costUsd === "number") {
    if (details.costUsd === 0 && row.status === "FAILED") return { text: "$0 · not billed", tone: "none" }
    return { text: `$${details.costUsd.toFixed(3)}`, tone: "actual" }
  }
  if (row.status === "STARTED" && typeof details.estimatedUsd === "number") {
    return { text: `≈ $${details.estimatedUsd.toFixed(2)} · rendering`, tone: "estimate" }
  }
  return { text: row.status === "SUCCEEDED" ? "not recorded" : "—", tone: "none" }
}

/** The facts worth scanning for: resolution, draft, length, references, usage. */
function summary(details: unknown): string {
  const value = record(details)
  const parts: string[] = []
  if (typeof value.format === "string") parts.push(value.format)
  if (typeof value.resolution === "string") parts.push(value.resolution)
  if (value.draft === true) parts.push("draft")
  if (typeof value.finalOfDraft === "string") parts.push("final of draft")
  if (typeof value.duration === "number") parts.push(`${value.duration}s`)
  const references = typeof value.productReferences === "number" ? value.productReferences : value.referenceImages
  if (typeof references === "number" && references > 0) parts.push(`${references} product photo${references === 1 ? "" : "s"}`)
  if (typeof value.billedUnits === "number") parts.push(`${value.billedUnits.toLocaleString("en")} units`)
  return parts.join(" · ") || "—"
}

function seconds(ms: number | null | undefined) {
  return typeof ms === "number" ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s` : "—"
}

const STATUS_LABEL: Record<string, string> = { STARTED: "rendering", SUCCEEDED: "done", FAILED: "failed" }

export function GenerationLogTable({ rows }: { rows: LogRow[] }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Project</th>
            <th>Provider · model</th>
            <th>Status</th>
            <th>Details</th>
            <th>Took</th>
            <th>Cost</th>
            <th>Diagnostic</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const price = cost(row)
            return (
              <tr key={row.id}>
                <td>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(row.createdAt)}</td>
                <td className="log-project">{row.projectName ?? "—"}</td>
                <td><b>{row.provider}</b><br /><span className="log-model">{row.model ?? "—"}</span></td>
                <td><span className={`log-status log-${row.status.toLowerCase()}`}>{STATUS_LABEL[row.status] ?? row.status.toLowerCase()}</span></td>
                <td>{summary(row.details)}</td>
                <td>{seconds(row.durationMs)}</td>
                <td className={`log-cost log-cost-${price.tone}`}>{price.text}</td>
                <td>{row.safeErrorCode ?? "—"}<br /><code>{row.correlationId.slice(0, 8)}</code></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="table-empty">No generation logs yet.</p> : null}
    </div>
  )
}
