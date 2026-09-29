"use client"

import type { ReactNode } from "react"

import { ToastProvider } from "@/components/ui/toast"

/**
 * Client-side context boundary for the app.
 *
 * Kept as a single component so the root layout stays a server component: only
 * this subtree ships the provider code, and adding a future provider (session,
 * feature flags) does not turn the whole layout into a client component.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>
}
