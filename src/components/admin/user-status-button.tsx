"use client"

import { useState } from "react"

export function UserStatusButton({ userId, active }: { userId: string; active: boolean }) {
  const [isActive, setIsActive] = useState(active)
  const [pending, setPending] = useState(false)
  async function toggle() {
    setPending(true)
    const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, active: !isActive }) })
    if (response.ok) setIsActive(!isActive)
    setPending(false)
  }
  return <button className="table-action" type="button" onClick={toggle} disabled={pending}>{pending ? "Updating…" : isActive ? "Deactivate" : "Reactivate"}</button>
}
