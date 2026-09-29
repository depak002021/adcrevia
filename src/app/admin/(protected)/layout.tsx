import { redirect } from "next/navigation"

import { AdminSidebar } from "@/components/navigation/admin-sidebar"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireSuperAdmin()
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) redirect("/admin/login")
    throw error
  }
  return <div className="app-shell admin-shell"><AdminSidebar /><div className="app-content">{children}</div></div>
}
