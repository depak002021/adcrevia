# syntax=docker/dockerfile:1.7
#
# Adcrevia production image.
#
# Three stages:
#   deps     installs the locked dependency tree (and runs `prisma generate`).
#   build    compiles the Next.js standalone server and the background worker bundle.
#            Also used as-is by the one-shot `migrate` service in docker-compose.yml,
#            because it is the only stage with the Prisma CLI and tsx available.
#   runtime  the small image that actually serves traffic: node + ffmpeg + the two
#            build outputs. No package manager, no source, no dev dependencies.
#
# Nothing secret is needed at build time: `next build` has been verified to succeed with
# an empty environment. Secrets are supplied at run time from .env.production.

ARG NODE_VERSION=24

# ---------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# package.json pins pnpm through the `packageManager` field; corepack honours it.
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------------------
FROM base AS deps
# Only what `pnpm install` and its `prisma generate` postinstall read, so a source-only
# change does not invalidate the dependency layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------------------
FROM deps AS build
COPY . .

# Baked into the client bundle (canonical URL, sitemap, share card), so it must be known
# when the page is compiled rather than when the container starts.
ARG NEXT_PUBLIC_SITE_URL=https://adcrevia.com
# Short commit SHA, reported by /api/health and the worker's startup line.
ARG APP_REVISION=""
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    APP_REVISION=${APP_REVISION}

RUN pnpm build && pnpm build:worker

# ---------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# ffmpeg is the video composition engine. It comes from the distribution rather than
# npm so the binary matches the image's libc; /api/health reports whether it is present.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ARG APP_REVISION=""
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_REVISION=${APP_REVISION} \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# The standalone server carries its own traced node_modules. The worker bundle is fully
# self-contained (only Node built-ins remain external), so it needs nothing beside it.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist/worker.mjs ./dist/worker.mjs

# Local-disk media (used when no object storage is configured). Created here so the
# named volume mounted over it inherits the unprivileged user's ownership.
RUN mkdir -p /app/public/generated && chown -R node:node /app/public/generated

USER node
EXPOSE 3000

# The web server. The worker service in docker-compose.yml overrides this command with
# `node dist/worker.mjs` and reuses the same image.
CMD ["node", "server.js"]
