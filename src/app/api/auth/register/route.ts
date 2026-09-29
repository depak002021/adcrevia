import { z } from "zod"

import { isRegistrationOpen, REGISTRATION_CLOSED_MESSAGE } from "@/features/auth/registration"
import { hashPassword } from "@/lib/auth/password"
import { getPrisma } from "@/lib/db/prisma"
import { clientIdentifier, rateLimiter, rateLimitResponse } from "@/lib/security/rate-limit"
import { route } from "@/lib/http/route"

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
})

type CreateUserInput = {
  name: string
  email: string
  passwordHash: string
}

type RegisterDependencies = {
  createUser(input: CreateUserInput): Promise<{ id: string }>
}

export function createRegisterHandler(dependencies: RegisterDependencies) {
  return async function register(request: Request) {
    const body = await request.json().catch(() => null)
    const parsed = registrationSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: "Please check your details." }, { status: 400 })
    }

    const passwordHash = await hashPassword(parsed.data.password)

    try {
      await dependencies.createUser({
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
      })
      return Response.json({ ok: true }, { status: 201 })
    } catch (error) {
      if (isUniqueEmailError(error)) {
        return Response.json({ error: "An account with this email already exists." }, { status: 409 })
      }
      throw error
    }
  }
}

function isUniqueEmailError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
}

const register = createRegisterHandler({
  async createUser(input) {
    return getPrisma().user.create({ data: input, select: { id: true } })
  },
})

async function POSTHandler(request: Request) {
  // Closed unless an administrator has opened sign-up (Admin → Settings).
  if (!(await isRegistrationOpen())) {
    return Response.json({ error: REGISTRATION_CLOSED_MESSAGE, code: "REGISTRATION_CLOSED" }, { status: 403 })
  }
  const limit = await rateLimiter.check({
    action: "register",
    identifier: clientIdentifier(request),
    limit: 5,
    windowSeconds: 60 * 60,
  })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)
  return register(request)
}

export const POST = route(POSTHandler)
