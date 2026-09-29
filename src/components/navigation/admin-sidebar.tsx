"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  ClipboardList,
  HardDrive,
  ImageIcon,
  LayoutDashboard,
  Mail,
  MessageSquareQuote,
  ScrollText,
  Settings,
  Sparkles,
  Type,
  Users,
  Video,
} from "lucide-react"

import { AdcreviaMark } from "@/components/brand/adcrevia-mark"

const links = [
  ["/admin", "Overview", LayoutDashboard],
  ["/admin/users", "Users", Users],
  ["/admin/waitlist", "Waitlist", ClipboardList],
  ["/admin/api-providers/images", "Image providers", ImageIcon],
  ["/admin/api-providers/videos", "Video providers", Video],
  ["/admin/api-providers/flux", "FLUX / BFL", Sparkles],
  ["/admin/ai-text", "AI text", Type],
  ["/admin/prompts", "Prompts", MessageSquareQuote],
  ["/admin/storage", "Storage", HardDrive],
  ["/admin/email", "Email", Mail],
  ["/admin/logs", "Generation logs", ScrollText],
  ["/admin/settings", "System settings", Settings],
] as const

export function AdminSidebar() {
  const pathname = usePathname() ?? ""
  return (
    <aside className="app-sidebar admin-sidebar">
      <div className="app-brand"><AdcreviaMark /></div>
      <p className="sidebar-kicker"><Activity size={14} aria-hidden /> Operations</p>
      <nav aria-label="Administration">
        {links.map(([href, label, Icon]) => {
          const active = href === "/admin" ? pathname === href : pathname.startsWith(href)
          return <Link key={href} href={href} aria-current={active ? "page" : undefined}><Icon size={18} aria-hidden />{label}</Link>
        })}
      </nav>
      <div className="sidebar-status"><span />Systems monitored</div>
    </aside>
  )
}
