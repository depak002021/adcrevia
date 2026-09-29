import "dotenv/config"

import { z } from "zod"

import { hashPassword } from "../src/lib/auth/password"
import { getPrisma } from "../src/lib/db/prisma"

async function main() {
  const input = z.object({
    SUPER_ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
    SUPER_ADMIN_PASSWORD: z.string().min(16).max(128),
    SUPER_ADMIN_NAME: z.string().trim().min(2).max(80).default("Adcrevia Administrator"),
  }).parse(process.env)

  const passwordHash = await hashPassword(input.SUPER_ADMIN_PASSWORD)
  const user = await getPrisma().user.upsert({
    where: { email: input.SUPER_ADMIN_EMAIL },
    create: {
      email: input.SUPER_ADMIN_EMAIL,
      name: input.SUPER_ADMIN_NAME,
      passwordHash,
      role: "SUPER_ADMIN",
      active: true,
    },
    update: {
      name: input.SUPER_ADMIN_NAME,
      passwordHash,
      authVersion: { increment: 1 },
      role: "SUPER_ADMIN",
      active: true,
    },
    select: { id: true, email: true, role: true, active: true },
  })

  process.stdout.write(`Super admin ready: ${user.email} (${user.id})\n`)
  await getPrisma().$disconnect()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Super admin bootstrap failed")
  process.exitCode = 1
})
