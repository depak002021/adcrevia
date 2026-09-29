import { z } from "zod"

import { createUserByAdmin, listUsers, setUserActive } from "@/features/admin/users/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

async function GETHandler(request: Request) {
  await requireSuperAdmin()
  return Response.json({ users: await listUsers(new URL(request.url).searchParams.get("q") ?? "") })
}

async function PATCHHandler(request: Request) {
  const admin = await requireSuperAdmin()
  const parsed = z.object({ userId: z.string().cuid(), active: z.boolean() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid user update." }, { status: 400 })
  return Response.json(await setUserActive(parsed.data.userId, parsed.data.active, admin.id))
}

const newUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
  role: z.enum(["USER", "SUPER_ADMIN"]).default("USER"),
})

async function POSTHandler(request: Request) {
  await requireSuperAdmin()
  const parsed = newUserSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Check the details: a name, a valid email and a password of at least 12 characters." }, { status: 400 })
  }
  return Response.json({ user: await createUserByAdmin(parsed.data) }, { status: 201 })
}

export const GET = route(GETHandler)
export const POST = route(POSTHandler)
export const PATCH = route(PATCHHandler)
