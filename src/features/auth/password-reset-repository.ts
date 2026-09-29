import { getPrisma } from "@/lib/db/prisma"

import type { PasswordResetRepository } from "./password-reset"

export const passwordResetRepository: PasswordResetRepository = {
  findActiveUserByEmail(email) {
    return getPrisma().user.findFirst({
      where: { email, active: true },
      select: { id: true, email: true, name: true },
    })
  },

  async replaceToken(input) {
    await getPrisma().$transaction([
      getPrisma().passwordResetToken.deleteMany({ where: { userId: input.userId } }),
      getPrisma().passwordResetToken.create({ data: input }),
    ])
  },

  async consumeToken(tokenHash, now) {
    const result = await getPrisma().passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (result.count !== 1) return null
    return getPrisma().passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true },
    })
  },

  async updatePasswordAndRevokeSessions(userId, passwordHash) {
    await getPrisma().$transaction([
      getPrisma().user.update({ where: { id: userId }, data: { passwordHash, authVersion: { increment: 1 } } }),
      getPrisma().session.deleteMany({ where: { userId } }),
    ])
  },
}
