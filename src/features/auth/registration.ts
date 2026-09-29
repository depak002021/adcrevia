import { getPrisma } from "@/lib/db/prisma"

/**
 * Whether anyone can create an account from the sign-up page.
 *
 * Closed unless an administrator opens it (Admin → Settings): during the POC the
 * admin creates every account (Admin → Users). Stored as a system setting so it is
 * changed without a deploy; a missing or unreadable row means closed.
 */
export const REGISTRATION_SETTING_KEY = "auth.registrationOpen"

export async function isRegistrationOpen(): Promise<boolean> {
  try {
    const row = await getPrisma().systemSetting.findUnique({ where: { key: REGISTRATION_SETTING_KEY } })
    return row?.value === true
  } catch {
    return false
  }
}

export async function setRegistrationOpen(open: boolean): Promise<boolean> {
  const row = await getPrisma().systemSetting.upsert({
    where: { key: REGISTRATION_SETTING_KEY },
    create: { key: REGISTRATION_SETTING_KEY, value: open },
    update: { value: open },
  })
  return row.value === true
}

export const REGISTRATION_CLOSED_MESSAGE = "Sign-up is closed. Ask your Adcrevia administrator for an account."
