import { describeStorage } from "@/lib/storage/configuration"
import { getPrisma } from "@/lib/db/prisma"

export async function getAdminDashboardSummary() {
  const db = getPrisma()
  const [users, projects, images, videos, imageFailures, videoFailures, imageProviders, videoProviders] = await Promise.all([
    db.user.count({ where: { active: true } }),
    db.project.count(),
    db.generatedImage.count({ where: { status: "COMPLETED" } }),
    db.generatedVideo.count({ where: { status: "COMPLETED" } }),
    db.generatedImage.count({ where: { status: "FAILED" } }),
    db.generatedVideo.count({ where: { status: "FAILED" } }),
    // Distinct configured providers per kind (a credential row exists).
    db.aPIConfiguration.findMany({ where: { provider: { kind: "IMAGE" } }, select: { provider: { select: { slug: true } } } }),
    db.aPIConfiguration.findMany({ where: { provider: { kind: "VIDEO" } }, select: { provider: { select: { slug: true } } } }),
  ])

  const imageSlugs = new Set(imageProviders.map((row) => row.provider.slug))
  const videoSlugs = new Set(videoProviders.map((row) => row.provider.slug))
  const activeImage = await db.aPIConfiguration.findFirst({ where: { enabled: true, provider: { kind: "IMAGE" } }, select: { model: true, provider: { select: { slug: true } } } })
  const activeVideo = await db.aPIConfiguration.findFirst({ where: { enabled: true, provider: { kind: "VIDEO" } }, select: { model: true, provider: { select: { slug: true } } } })

  return {
    users,
    projects,
    images,
    videos,
    failures: imageFailures + videoFailures,
    readiness: {
      imageProviderCount: imageSlugs.size,
      videoProviderCount: videoSlugs.size,
      activeImage: activeImage ? { slug: activeImage.provider.slug, model: activeImage.model } : null,
      activeVideo: activeVideo ? { slug: activeVideo.provider.slug, model: activeVideo.model } : null,
      // Console-configured storage counts too, not only the environment variables.
      storageConfigured: (await describeStorage()).configured,
    },
  }
}
