import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "@/generated/prisma/client"

import { rewriteMediaUrls, type MediaBase } from "./media-urls"

function createClient(connectionString: string) {
  const base = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

  // The current public media address, read with the plain client (so this lookup is
  // not itself rewritten) and cached briefly: it changes only when an admin saves
  // Admin → Storage.
  let cached: { at: number; value: MediaBase | null } | null = null
  async function mediaBase(): Promise<MediaBase | null> {
    if (cached && Date.now() - cached.at < 60_000) return cached.value
    let value: MediaBase | null = null
    try {
      const row = await base.aPIConfiguration.findFirst({
        where: { enabled: true, provider: { kind: "STORAGE", slug: "storage-r2" } },
        orderBy: { createdAt: "desc" },
        select: { settings: true },
      })
      const settings = row?.settings as { publicBaseUrl?: unknown; bucket?: unknown } | null
      const publicBaseUrl = typeof settings?.publicBaseUrl === "string" ? settings.publicBaseUrl : process.env.R2_PUBLIC_BASE_URL
      const bucket = typeof settings?.bucket === "string" ? settings.bucket : process.env.R2_BUCKET
      value = publicBaseUrl && bucket ? { publicBaseUrl, bucket } : null
    } catch {
      value = null
    }
    cached = { at: Date.now(), value }
    return value
  }

  // Stored media links are returned pointing at the bucket's current public address
  // (see media-urls.ts). Only results change; what is stored never does.
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const result = await query(args)
          const media = await mediaBase()
          return media ? rewriteMediaUrls(result, media) : result
        },
      },
    },
  })
}

type AppPrismaClient = ReturnType<typeof createClient>

const globalForPrisma = globalThis as unknown as { prisma: AppPrismaClient | undefined }

/**
 * One Prisma client — and therefore one `pg` connection pool — per process.
 *
 * The client is cached on `globalThis` in EVERY environment. An earlier version only
 * cached it outside production (a half-remembered form of the Next.js dev pattern, which
 * exists to survive hot reload), so in production each call built a fresh client with a
 * fresh pool. Measured against a production build: 25 waitlist signups left 75 open
 * connections, and PostgreSQL's default limit is 100. `globalThis` rather than a module
 * variable so the dev server's hot reload also reuses the same pool.
 */
export function getPrisma() {
  if (globalForPrisma.prisma) return globalForPrisma.prisma

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL is required for database access")

  const client = createClient(connectionString)
  globalForPrisma.prisma = client
  return client
}
