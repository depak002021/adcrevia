import { getPrisma } from "@/lib/db/prisma"
import { getDefaultImageCount } from "@/features/admin/settings/service"
import { projectInputSchema } from "./schemas"

type ProjectCreateClient = {
  project: {
    create(args: {
      data: Record<string, unknown>
      include: { prompt: true; websiteReference: true; brandPalette: true }
    }): Promise<unknown>
  }
}

export async function createProjectDraft(
  raw: unknown,
  userId: string,
  db: ProjectCreateClient = getPrisma() as unknown as ProjectCreateClient,
  readTargetImageCount: () => Promise<number> = getDefaultImageCount,
) {
  const input = projectInputSchema.parse(raw)
  const websiteUrl = input.websiteUrl ? new URL(input.websiteUrl).toString() : undefined
  const targetImageCount = await readTargetImageCount()
  return db.project.create({
    data: {
      userId,
      name: deriveProjectName(input.prompt),
      status: "DRAFT",
      targetImageCount,
      prompt: { create: { original: input.prompt } },
      websiteReference: websiteUrl ? { create: { url: websiteUrl } } : undefined,
      brandPalette: input.brandPalette.length
        ? { create: { colors: input.brandPalette, derived: false } }
        : undefined,
    },
    include: { prompt: true, websiteReference: true, brandPalette: true },
  })
}

/**
 * A project's display name, from the first thing said about it.
 *
 * Exported because the conversational brief creates projects too, and two
 * different naming rules for the same kind of row would show up as an
 * inconsistency in the project list.
 */
export function deriveProjectName(prompt: string) {
  const compact = prompt.replace(/\s+/g, " ").trim()
  return compact.length <= 56 ? compact : `${compact.slice(0, 53).trimEnd()}…`
}
