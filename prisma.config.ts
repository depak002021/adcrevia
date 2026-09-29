import "dotenv/config"

import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://adcrevia:adcrevia@localhost:5432/adcrevia",
    /**
     * Required by `prisma migrate diff --from-migrations`, which replays the
     * migration history into a scratch database to compute a diff. `migrate dev`
     * does not need it when the application role may create databases, but the
     * diff command fails outright without it.
     *
     * Point it at an empty throwaway database. Never at a database holding data:
     * Prisma resets it on every use.
     */
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
})
