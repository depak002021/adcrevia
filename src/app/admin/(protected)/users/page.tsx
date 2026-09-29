import { CreateUserForm } from "@/components/admin/create-user-form"
import { UserStatusButton } from "@/components/admin/user-status-button"
import { listUsers } from "@/features/admin/users/service"

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams
  const users = await listUsers(q)
  return <main className="studio-page"><header className="studio-header"><div><p className="eyebrow">Account operations</p><h1>Users</h1><p>Search, review, and control access without exposing authentication internals.</p></div></header><CreateUserForm /><form className="project-search"><input name="q" defaultValue={q} placeholder="Search name or email" aria-label="Search users" /><button>Search</button></form><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Projects</th><th>Joined</th><th>Action</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name ?? "Unnamed user"}</strong><small>{user.email}</small></td><td>{user.role.replace("_", " ").toLowerCase()}</td><td><span className={`log-status ${user.active ? "log-succeeded" : "log-failed"}`}>{user.active ? "active" : "inactive"}</span></td><td>{user._count.projects}</td><td>{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(user.createdAt)}</td><td><UserStatusButton userId={user.id} active={user.active} /></td></tr>)}</tbody></table></div></main>
}
