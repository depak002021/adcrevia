# Adcrevia Production Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete, deployed Adcrevia prompt-to-image-to-video SaaS defined by the approved production design.

**Architecture:** Implement four ordered, independently testable milestones in one Next.js App Router codebase. Each milestone leaves the application runnable and adds a complete vertical capability without weakening the shared security or persistence boundaries.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind CSS, shadcn/ui, Framer Motion, Auth.js, Prisma, Neon PostgreSQL, OpenAI, Runway, Resend, Cloudflare-compatible object storage and hosting.

**Spec:** `docs/superpowers/specs/2026-09-17-adcrevia-design.md`

## Global Constraints

- Product name is Adcrevia.
- Generate exactly four creative directions and exactly four product images per standard generation run.
- Generate images sequentially in concept order; never present them as simultaneous work.
- Never fabricate provider progress percentages.
- Use `USER` and `SUPER_ADMIN` roles with server-side authorization.
- Keep provider credentials encrypted at rest and absent from browser-delivered data and logs.
- Store generated media in object storage, not PostgreSQL.
- Use real configured providers in production; do not ship fake production responses.
- Support desktop, tablet, mobile, keyboard navigation, visible focus, and reduced motion.

---

## Ordered Plans

1. `docs/superpowers/plans/2026-09-17-adcrevia-foundation-auth.md`
   Produces the runnable application shell, Prisma schema, authentication, role enforcement, encryption, validation, and protected dashboard/admin boundaries.
2. `docs/superpowers/plans/2026-09-17-adcrevia-image-workflow.md`
   Produces prompt/website/palette analysis, four directions, sequential image generation, stored media, evaluation, selection, and project recovery.
3. `docs/superpowers/plans/2026-09-17-adcrevia-video-workflow.md`
   Produces selected-image video creation, Runway task tracking, stored video results, playback, download, and retries.
4. `docs/superpowers/plans/2026-09-17-adcrevia-admin-deployment.md`
   Produces provider administration, user/log dashboards, password-reset email, production hardening, migrations, deployment, and end-to-end smoke verification.

## Program Exit Gate

- [ ] Run all unit and integration tests: `pnpm test`
- [ ] Run browser journeys: `pnpm test:e2e`
- [ ] Run production build: `pnpm build`
- [ ] Inspect browser bundles and API payloads for credential leakage.
- [ ] Complete one deployed real-provider prompt-to-video project.
- [ ] Verify a normal user receives `403` from every admin endpoint.
- [ ] Verify the production health endpoint and provider diagnostics.

