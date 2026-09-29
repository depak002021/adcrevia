import { redirect } from "next/navigation"

import { DashboardSidebar } from "@/components/navigation/dashboard-sidebar"
import { requireUser } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireUser()
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/login")
    throw error
  }

  return <div className="app-shell"><DashboardSidebar /><div className="app-content">{children}</div></div>
}
