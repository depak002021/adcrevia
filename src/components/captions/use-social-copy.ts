"use client"

import { useCallback, useEffect, useState } from "react"

import type { SocialCopy } from "@/features/captions/schema"

/**
 * The project's stored captions. Reading never calls a model; `write` does, once,
 * and only when the user presses the button.
 */
export function useSocialCopy(projectId: string, enabled = true) {
  const [copy, setCopy] = useState<SocialCopy | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch(`/api/projects/${projectId}/captions`)
      .then((response) => (response.ok ? response.json() : { copy: null }))
      .then((body: { copy: SocialCopy | null }) => {
        if (!cancelled) setCopy(body.copy)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, enabled])

  const write = useCallback(async () => {
    setWriting(true)
    setError("")
    try {
      const response = await fetch(`/api/projects/${projectId}/captions`, { method: "POST" })
      const body = (await response.json().catch(() => ({}))) as { copy?: SocialCopy; error?: string }
      if (!response.ok || !body.copy) throw new Error(body.error ?? "Captions could not be written. Try again.")
      setCopy(body.copy)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Captions could not be written. Try again.")
    } finally {
      setWriting(false)
    }
  }, [projectId])

  return { copy, loaded, writing, error, write }
}
