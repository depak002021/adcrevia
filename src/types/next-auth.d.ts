import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string
      role: "USER" | "SUPER_ADMIN"
      active: boolean
    }
  }

  interface User {
    role: "USER" | "SUPER_ADMIN"
    active: boolean
    authVersion: number
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "USER" | "SUPER_ADMIN"
    active?: boolean
    authVersion?: number
  }
}
