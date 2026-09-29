import type { NextAuthOptions } from "next-auth"
import { getServerSession } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { z } from "zod"

import { getPrisma } from "@/lib/db/prisma"
import { rateLimiter } from "@/lib/security/rate-limit"
import { verifyPassword } from "./password"

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
})

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) return null

        const limit = await rateLimiter.check({
          action: "login",
          identifier: parsed.data.email,
          limit: 10,
          windowSeconds: 15 * 60,
        })
        if (!limit.allowed) return null

        const user = await getPrisma().user.findUnique({
          where: { email: parsed.data.email },
          select: { id: true, email: true, name: true, passwordHash: true, role: true, active: true, authVersion: true },
        })
        if (!user?.passwordHash || !user.active) return null
        if (!(await verifyPassword(user.passwordHash, parsed.data.password))) return null

        return { id: user.id, email: user.email, name: user.name, role: user.role, active: user.active, authVersion: user.authVersion }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.active = user.active
        token.authVersion = user.authVersion
      } else if (token.sub) {
        const current = await getPrisma().user.findUnique({
          where: { id: token.sub },
          select: { role: true, active: true, authVersion: true },
        })
        token.role = current?.role
        token.active = (current?.active ?? false) && current?.authVersion === token.authVersion
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.sub ?? ""
      session.user.role = token.role ?? "USER"
      session.user.active = token.active ?? false
      return session
    },
  },
}

export function auth() {
  return getServerSession(authOptions)
}
