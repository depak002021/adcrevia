import { getPrisma } from "@/lib/db/prisma"
import { hashPassword } from "@/lib/auth/password"
import { HttpError } from "@/lib/http/http-error"

export async function listUsers(query = "", take = 100) {
  return getPrisma().user.findMany({
    where: query ? { OR: [{ email: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 250),
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, _count: { select: { projects: true, sessions: true } } },
  })
}

export async function setUserActive(userId: string, active: boolean, actorId: string) {
  if (userId === actorId && !active) throw new HttpError(400, "You cannot deactivate your own account")
  return getPrisma().user.update({ where: { id: userId }, data: { active }, select: { id: true, active: true } })
}

/** An account created by an admin (sign-up may be closed). */
export async function createUserByAdmin(input: { name: string; email: string; password: string; role: "USER" | "SUPER_ADMIN" }) {
  const passwordHash = await hashPassword(input.password)
  try {
    return await getPrisma().user.create({
      data: { name: input.name, email: input.email, passwordHash, role: input.role },
      select: { id: true, email: true, name: true, role: true },
    })
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new HttpError(409, "An account with this email already exists.")
    }
    throw error
  }
}
