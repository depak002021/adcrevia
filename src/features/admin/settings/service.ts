import { getPrisma } from "@/lib/db/prisma"
import { HttpError } from "@/lib/http/http-error"

import { generationPolicySchema, type GenerationPolicy } from "./schemas"

const generationPolicyKey = "generation.defaultImageCount"
const defaultImageCount = 4

export type GenerationPolicyRepository = {
  read(key: string): Promise<unknown>
  write(key: string, value: number): Promise<unknown>
}

type AdminActor = { id: string; role: "USER" | "SUPER_ADMIN" }

export async function getDefaultImageCount(repository: GenerationPolicyRepository = prismaGenerationPolicyRepository) {
  const value = await repository.read(generationPolicyKey)
  return generationPolicySchema.shape.defaultImageCount.catch(defaultImageCount).parse(value)
}

export async function getGenerationPolicy(repository: GenerationPolicyRepository = prismaGenerationPolicyRepository): Promise<GenerationPolicy> {
  return { defaultImageCount: await getDefaultImageCount(repository) }
}

export async function saveGenerationPolicy(
  raw: unknown,
  admin: AdminActor,
  repository: GenerationPolicyRepository = prismaGenerationPolicyRepository,
): Promise<GenerationPolicy> {
  assertSuperAdmin(admin)
  const policy = generationPolicySchema.parse(raw)
  await repository.write(generationPolicyKey, policy.defaultImageCount)
  return policy
}

function assertSuperAdmin(admin: AdminActor) {
  if (admin.role !== "SUPER_ADMIN") throw new HttpError(403, "Forbidden")
}

const prismaGenerationPolicyRepository: GenerationPolicyRepository = {
  async read(key) {
    const row = await getPrisma().systemSetting.findUnique({ where: { key } })
    return row?.value
  },
  async write(key, value) {
    const row = await getPrisma().systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    })
    return row.value
  },
}
