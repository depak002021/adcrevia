# Adcrevia

Adcrevia is a production-oriented AI studio for turning a product brief into four creative image concepts, selecting a preferred result, and generating a campaign video from that image.

## Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS
- PostgreSQL with Prisma 7
- Auth.js credentials authentication with Argon2id
- OpenAI structured responses and image generation
- Runway image-to-video generation
- Cloudflare R2 object storage
- Resend transactional email
- Docker Compose on a VPS, behind nginx (PostgreSQL, web app, background worker)

## Local setup

1. Copy `.env.example` to `.env.local` and provide the required values.
2. Install dependencies with `pnpm install`.
3. Apply the database schema with `pnpm db:migrate`.
4. Set `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`, then run `pnpm admin:bootstrap`.
5. Start the app with `pnpm dev`.

`pnpm test` runs the unit and component suite. `pnpm build` performs Prisma generation and a production Next.js build.

## Generation providers

Images can be generated with OpenAI or FLUX.2 (`flux-2-pro`), and videos with Runway or FLUX 3 (`flux-3-video`). Black Forest Labs (FLUX) access uses a single server-only key:

- `BFL_API_KEY` — server-only Black Forest Labs key. Never exposed to the client.
- `BFL_IMAGE_MODEL` — optional override for the environment fallback; defaults to `flux-2-pro`.
- `BFL_VIDEO_MODEL` — optional override for the environment fallback; defaults to `flux-3-video`.

Database provider configuration (Admin → API providers) always takes precedence over these environment fallbacks. The environment values are only used when no active database configuration exists for a given kind, and malformed active database credentials fail closed rather than silently reverting to the environment. A single submitted BFL key is encrypted separately for the image and video providers, each of which can be enabled independently.

Provider connection tests check credit availability only. They never return credit balances, key fragments, response headers, or raw provider bodies — only a safe connection status. FLUX generation runs asynchronously: the server holds the polling URL as private task metadata and never returns it, provider keys, or media bytes to the client.

Production requires durable media storage (Cloudflare R2 or an S3-compatible bucket). Generated images and completed videos are copied into that bucket, so ephemeral or local-only storage is not sufficient for a deployed environment.

## Production deployment

Production runs on a single VPS with Docker Compose: PostgreSQL, a one-shot migration step, the Next.js server and the background worker (which needs ffmpeg and therefore cannot run on a serverless platform). nginx on the host terminates TLS. The complete runbook, from a fresh server to a live site, is [docs/deployment/hostinger-vps.md](docs/deployment/hostinger-vps.md). In short:

```bash
cp deploy/env.production.example .env.production   # then fill it in
./deploy/deploy.sh                                  # pull, build, migrate, restart
./deploy/deploy.sh bootstrap-admin                  # once
```

After deployment, run the smoke check (see the runbook for the containerised form): `SMOKE_BASE_URL=https://your-domain.example pnpm smoke:production`. The script checks readiness, the public landing page, and security headers. `/api/health` intentionally exposes only boolean service readiness and never secret values. When `DATABASE_URL` is set, the smoke script also verifies workflow invariants: the generation policy is a whole number from 1 to 10, active providers use kind-specific slugs, no serialized provider exposes encrypted credentials, ordered image selections have unique contiguous positions, and stored video sources preserve contiguous 1..n order.

Password reset tokens are random, SHA-256 hashed at rest, single-use, and expire after one hour. Rate-limit buckets are persisted in PostgreSQL so limits remain effective across serverless instances. Provider credentials are encrypted with AES-256-GCM and are only decrypted server-side.
