"use client"

import { useEffect, useState } from "react"

import type { ExpectedTimes } from "@/features/timing/expected"

let shared: Promise<ExpectedTimes | null> | null = null

/** Typical render times per model (fetched once per page). */
export function useExpectedTimes(): ExpectedTimes | null {
  const [times, setTimes] = useState<ExpectedTimes | null>(null)
  useEffect(() => {
    shared ??= fetch("/api/timings")
      .then((response) => (response.ok ? (response.json() as Promise<ExpectedTimes>) : null))
      .catch(() => null)
    let cancelled = false
    shared.then((value) => {
      if (!cancelled) setTimes(value)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return times
}
