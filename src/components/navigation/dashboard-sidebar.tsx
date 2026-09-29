"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Clapperboard, FolderKanban, ImageIcon, LayoutDashboard, Plus, Settings } from "lucide-react"

import { AdcreviaMark } from "@/components/brand/adcrevia-mark"

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/create", label: "Create", icon: Plus },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/generations", label: "Images", icon: ImageIcon },
  { href: "/dashboard/videos", label: "Videos", icon: Clapperboard },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
]

export function DashboardSidebar() {
  const pathname = usePathname() ?? ""
  return (
    <aside className="app-sidebar">
      <div className="app-brand"><AdcreviaMark /></div>
      <nav aria-label="Creative studio">
        {links.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return <Link key={href} href={href} aria-current={active ? "page" : undefined}><Icon size={18} aria-hidden />{label}</Link>
        })}
      </nav>
      <div className="sidebar-status"><span />AI studio online</div>
    </aside>
  )
}
