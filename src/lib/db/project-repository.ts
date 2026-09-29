import { getPrisma } from "./prisma"

type ProjectCreateClient = {
  project: {
    create(args: {
      data: {
        userId: string
        name: string
        prompt: { create: { original: string } }
      }
      include: { prompt: true }
    }): Promise<unknown>
  }
}

export async function createDraftProject(
  input: { userId: string; name: string; prompt: string },
  db: ProjectCreateClient = getPrisma(),
) {
  return db.project.create({
    data: {
      userId: input.userId,
      name: input.name,
      prompt: { create: { original: input.prompt } },
    },
    include: { prompt: true },
  })
}
