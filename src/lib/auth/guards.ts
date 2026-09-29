import type { Session } from "next-auth"

import { auth } from "./config"
import { HttpError } from "@/lib/http/http-error"

export type AppSession = Session & {
  user: NonNullable<Session["user"]> & {
    id: string
    role: "USER" | "SUPER_ADMIN"
    active: boolean
  }
}

export async function requireUser(session?: AppSession | null) {
  const currentSession = session === undefined ? await auth() : session
  if (!currentSession?.user) throw new HttpError(401, "Authentication required")
  if (!currentSession.user.active) throw new HttpError(403, "Account inactive")
  return currentSession.user
}

export async function requireSuperAdmin(session?: AppSession | null) {
  const user = await requireUser(session)
  if (user.role !== "SUPER_ADMIN") throw new HttpError(403, "Forbidden")
  return user
}
