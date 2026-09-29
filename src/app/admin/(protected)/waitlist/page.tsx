import { listWaitlistSignups } from "@/features/marketing/service"

/**
 * Waitlist signups from the landing page, newest first.
 *
 * Read-only on purpose. The point of storing signups as rows rather than a CSV beside
 * the static export was to plan the rollout from real data; this is where that data
 * becomes visible without a database client. Access is enforced by the protected admin
 * layout, which requires a super administrator.
 */
export default async function AdminWaitlistPage() {
  const signups = await listWaitlistSignups()
  const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

  return (
    <main className="studio-page">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Rollout planning</p>
          <h1>Waitlist</h1>
          <p>
            {signups.length === 0
              ? "No signups yet. They appear here as soon as someone joins from the landing page."
              : `${signups.length} most recent signup${signups.length === 1 ? "" : "s"} from the landing page.`}
          </p>
        </div>
      </header>
      {signups.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Sells</th>
                <th>Business</th>
                <th>Website</th>
                <th>Heard from</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {signups.map((signup) => (
                <tr key={signup.id}>
                  <td>
                    <strong>{signup.name}</strong>
                    <small>{signup.email}</small>
                  </td>
                  <td>{signup.sells}</td>
                  <td>{signup.businessType}</td>
                  <td>
                    {signup.website ? (
                      // Visitor-supplied URL: opened without a referrer or opener handle.
                      <a href={signup.website} target="_blank" rel="noopener noreferrer nofollow">
                        {signup.website.replace(/^https?:\/\//i, "")}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{signup.source ?? "—"}</td>
                  <td>{date.format(signup.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  )
}
