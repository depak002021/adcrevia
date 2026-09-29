"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { CheckCircle, Info, WarningCircle, X } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/cn"

/**
 * Transient notifications.
 *
 * There was no notification system at all: every outcome was a bare `<p>` glued
 * under a form, which meant a successful save produced no feedback and a failed
 * one could scroll out of view. Actions that complete away from the user's focus
 * — an order saved, a render finished, a credential stored — need to announce
 * themselves.
 *
 * Deliberately dependency-free. A toast stack is a small amount of state and one
 * live region; pulling in a library for it would add more surface than it saves.
 *
 * Announcement policy: success and info go in a `polite` region so they do not
 * interrupt; errors get `role="alert"` and `assertive`, because a failed action
 * is exactly the case where interrupting is correct.
 */

type Tone = "success" | "error" | "info"

type Toast = {
  id: number
  tone: Tone
  title: string
  description?: string
  /** Milliseconds. Errors default to staying until dismissed. */
  duration: number | null
}

type ToastInput = {
  tone?: Tone
  title: string
  description?: string
  duration?: number | null
}

const ToastContext = createContext<((input: ToastInput) => void) | null>(null)

const DEFAULT_DURATION = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    ({ tone = "info", title, description, duration }: ToastInput) => {
      const id = nextId.current++
      const resolved =
        duration !== undefined ? duration : tone === "error" ? null : DEFAULT_DURATION

      setToasts((current) => {
        // Cap the stack so a retry loop cannot bury the screen.
        const next = [...current, { id, tone, title, description, duration: resolved }]
        return next.slice(-4)
      })

      if (resolved !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), resolved),
        )
      }
    },
    [dismiss],
  )

  // Clearing on unmount matters in dev, where fast refresh remounts the
  // provider and would otherwise leave orphaned timers firing setState.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-[58] flex flex-col items-center gap-2 px-4",
          "sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end",
        )}
        style={{ paddingBottom: "calc(1rem + var(--safe-bottom))" }}
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const toneIcon = { success: CheckCircle, error: WarningCircle, info: Info }
const toneColour: Record<Tone, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-accent",
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = toneIcon[toast.tone]
  const isError = toast.tone === "error"

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3",
        "rounded-inner bg-ink-3/95 px-4 py-3.5 backdrop-blur-xl",
        "shadow-[0_24px_64px_-28px_rgb(0_0_0/0.9),inset_0_0_0_1px_var(--line-strong)]",
        "animate-surface-in",
      )}
    >
      <Icon
        size={18}
        weight="light"
        aria-hidden="true"
        className={cn("mt-px shrink-0", toneColour[toast.tone])}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[0.9rem] font-medium text-fg">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-[0.82rem] leading-snug text-muted">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="-mt-1 -mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-white/[0.07] hover:text-fg"
      >
        <span className="sr-only">Dismiss</span>
        <X size={14} weight="light" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Throws when used outside the provider rather than silently no-opping, so a
 * missing provider surfaces in development instead of swallowing every
 * notification in production.
 */
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error("useToast must be used inside <ToastProvider>")
  return context
}
