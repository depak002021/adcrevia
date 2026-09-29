# Adcrevia Administration and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete provider administration, user and log operations, password recovery, production hardening, deployment, and real-provider acceptance testing.

**Architecture:** Administrative services expose masked, least-privilege data through server-authorized routes. Deployment configuration supplies database, encryption, storage, email, and bootstrap secrets; production verification exercises the same public APIs and provider adapters used by users.

**Tech Stack:** Next.js, Prisma, Auth.js, Resend, Zod, Vitest, Playwright, Vercel hosting, PostgreSQL, and Cloudflare R2 object storage.

**Spec:** `docs/superpowers/specs/2026-09-17-adcrevia-design.md`

## Global Constraints

- Image and video provider configurations remain independent.
- Never return saved credentials in plaintext or a recoverable partial form.
- Normal users must receive `403` from every admin endpoint.
- Logs must exclude credentials, passwords, tokens, authorization headers, and raw sensitive bodies.
- Production has no fake provider responses.
- Deployment must pass database migrations, health checks, responsive checks, and one real prompt-to-video smoke journey.

---

### Task 1: Provider Configuration and Connection Tests

**Files:**
- Create: `src/features/admin/providers/schemas.ts`
- Create: `src/features/admin/providers/service.ts`
- Create: `src/app/api/admin/providers/route.ts`
- Create: `src/app/api/admin/providers/test/route.ts`
- Create: `src/app/admin/api-providers/images/page.tsx`
- Create: `src/app/admin/api-providers/videos/page.tsx`
- Create: `src/components/admin/api-provider-card.tsx`
- Test: `src/features/admin/providers/service.test.ts`

**Interfaces:**
- Produces: `saveProviderConfiguration(input, admin)`, `listMaskedProviders(kind)`, `testProviderConfiguration(input, admin)`.
- Consumes: encryption utilities, admin guard, image/video provider factories.

- [ ] **Step 1: Write failing masking and separation tests**

```ts
it("returns a fixed mask and never ciphertext or plaintext", async () => {
  await saveProviderConfiguration(imageConfig, superAdmin)
  const [result] = await listMaskedProviders("IMAGE")
  expect(result.apiKey).toBe("••••••••••••••••")
  expect(JSON.stringify(result)).not.toContain(imageConfig.apiKey)
})

it("activating an image provider does not change the video provider", async () => {
  await activateProvider(imageProvider.id, "IMAGE", superAdmin)
  expect((await activeProvider("VIDEO")).id).toBe(videoProvider.id)
})
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run src/features/admin/providers/service.test.ts`

Expected: FAIL because admin provider services are missing.

- [ ] **Step 3: Implement schemas, encrypted save, masks, and independent activation**

```ts
export const providerConfigurationSchema = z.object({
  kind: z.enum(["IMAGE", "VIDEO"]),
  provider: z.enum(["OPENAI", "RUNWAY"]),
  model: z.string().trim().min(1).max(100),
  endpoint: z.string().url().optional(),
  apiKey: z.string().min(16).max(500),
  enabled: z.boolean(),
})
```

Store only `encryptCredential(apiKey)`. Serialize only fixed masks, provider metadata, enabled state, and last safe test result.

- [ ] **Step 4: Implement server-side connection tests and admin forms**

```ts
export async function testProviderConfiguration(raw: unknown, admin = await requireSuperAdmin()) {
  const input = providerConfigurationSchema.parse(raw)
  const result = await providerFactory.fromUnsaved(input).testConnection()
  return { ok: result.ok, category: result.category, testedAt: new Date().toISOString() }
}
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run src/features/admin/providers/service.test.ts`

Expected: PASS for encryption, masking, role rejection, independent activation, and safe connection diagnostics.

```bash
git add src/features/admin/providers src/app/api/admin/providers src/app/admin/api-providers src/components/admin/api-provider-card.tsx
git commit -m "feat: manage encrypted AI provider configurations"
```

### Task 2: Admin Dashboard, Users, and Generation Logs

**Files:**
- Create: `src/features/admin/dashboard/service.ts`
- Create: `src/features/admin/users/service.ts`
- Create: `src/features/admin/logs/service.ts`
- Create: `src/app/api/admin/dashboard/route.ts`
- Create: `src/app/api/admin/users/route.ts`
- Create: `src/app/api/admin/logs/route.ts`
- Create: `src/app/admin/users/page.tsx`
- Create: `src/app/admin/logs/page.tsx`
- Create: `src/app/admin/settings/page.tsx`
- Create: `src/components/admin/generation-log-table.tsx`
- Test: `src/features/admin/logs/service.test.ts`
- Test: `e2e/admin.spec.ts`

**Interfaces:**
- Produces: dashboard aggregate query, paginated user search, activation control, sanitized log search.
- Consumes: generation records and `requireSuperAdmin()`.

- [ ] **Step 1: Write failing redaction and deactivation tests**

```ts
it("redacts sensitive values from stored and returned diagnostics", async () => {
  const log = await recordGenerationFailure({ message: "Bearer secret-key", authorization: "Bearer secret-key" })
  expect(JSON.stringify(log)).not.toContain("secret-key")
})

it("deactivated users cannot retain protected access", async () => {
  await setUserActive(user.id, false, superAdmin)
  await expect(requireUser(sessionFor(user))).rejects.toMatchObject({ status: 403 })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run src/features/admin/logs/service.test.ts`

Expected: FAIL because redaction and admin services are missing.

- [ ] **Step 3: Implement aggregates, pagination, activation, and log redaction**

```ts
export function sanitizeDiagnostic(value: unknown): unknown {
  return redactKeys(value, ["authorization", "apiKey", "password", "token", "cookie", "secret"])
}
```

Dashboard queries return total users/projects/images/videos/API calls/failures plus daily image, video, API, and failure series. User responses omit password hash, sessions, tokens, provider configurations, and authentication secrets. The settings page exposes only safe system policy values and uses explicit confirmation for mutable operational settings.

- [ ] **Step 4: Implement accessible tables, tabs, filters, pagination, and charts**

```tsx
<Tabs defaultValue="images">
  <TabsList aria-label="Generation log type">
    <TabsTrigger value="images">Image Logs</TabsTrigger>
    <TabsTrigger value="videos">Video Logs</TabsTrigger>
  </TabsList>
  <TabsContent value="images"><GenerationLogTable rows={imageLogs} /></TabsContent>
  <TabsContent value="videos"><GenerationLogTable rows={videoLogs} /></TabsContent>
</Tabs>
```

- [ ] **Step 5: Test admin boundaries and commit**

Run: `pnpm vitest run src/features/admin/logs/service.test.ts && pnpm playwright test e2e/admin.spec.ts`

Expected: PASS for normal-user rejection, safe user views, deactivation, sanitized logs, filters, and dashboard aggregates.

```bash
git add src/features/admin src/app/api/admin src/app/admin src/components/admin e2e/admin.spec.ts
git commit -m "feat: add secure administration and reporting"
```

### Task 3: Password Reset, Rate Limits, and Security Headers

**Files:**
- Create: `src/lib/email/resend.ts`
- Create: `src/features/auth/password-reset.ts`
- Create: `src/lib/security/rate-limit.ts`
- Create: `src/lib/security/headers.ts`
- Create: `src/app/(auth)/forgot-password/page.tsx`
- Create: `src/app/(auth)/reset-password/page.tsx`
- Create: `src/app/api/auth/forgot-password/route.ts`
- Create: `src/app/api/auth/reset-password/route.ts`
- Test: `src/features/auth/password-reset.test.ts`
- Test: `src/lib/security/rate-limit.test.ts`

**Interfaces:**
- Produces: `requestPasswordReset(email)`, `resetPassword(token, password)`, reusable keyed limiter and security headers.
- Consumes: Resend server credential and trusted application origin.

- [ ] **Step 1: Write failing token and enumeration tests**

```ts
it("returns the same response for existing and missing email addresses", async () => {
  expect(await requestPasswordReset(existing.email)).toEqual(await requestPasswordReset("missing@example.com"))
})

it("accepts a token once and stores only its hash", async () => {
  const token = await issueResetToken(user.id)
  expect(JSON.stringify(await storedResetToken(user.id))).not.toContain(token)
  await resetPassword(token, "New-strong-passphrase-42")
  await expect(resetPassword(token, "Another-passphrase-43")).rejects.toThrow("INVALID_OR_EXPIRED_TOKEN")
})
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run src/features/auth/password-reset.test.ts src/lib/security/rate-limit.test.ts`

Expected: FAIL because password reset and limiter are missing.

- [ ] **Step 3: Implement single-use reset tokens and Resend delivery**

```ts
const token = randomBytes(32).toString("base64url")
await db.passwordResetToken.create({
  data: { userId, tokenHash: sha256(token), expiresAt: addMinutes(new Date(), 30) },
})
await email.sendPasswordReset({ to: user.email, resetUrl: trustedResetUrl(token) })
```

- [ ] **Step 4: Implement rate limits and response headers**

```ts
export const authLimiter = createRateLimiter({ windowSeconds: 900, maxAttempts: 10 })
export const generationLimiter = createRateLimiter({ windowSeconds: 60, maxAttempts: 8 })
```

Apply stricter limits to login, password reset, website analysis, and generation endpoints. Add CSP, frame-ancestors, referrer policy, MIME sniffing protection, and permissions policy compatible with media playback.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run src/features/auth/password-reset.test.ts src/lib/security/rate-limit.test.ts && pnpm build`

Expected: PASS for enumeration resistance, expiry, single use, session invalidation, rate limits, and headers.

```bash
git add src/lib/email src/features/auth src/lib/security src/app/\(auth\) src/app/api/auth
git commit -m "feat: harden account recovery and public endpoints"
```

### Task 4: Production Configuration, Deployment, and End-to-End Acceptance

**Files:**
- Create: `.env.example`
- Create: `vercel.json`
- Create: `src/app/api/health/route.ts`
- Create: `scripts/bootstrap-super-admin.ts`
- Create: `scripts/smoke-production.ts`
- Create: `e2e/production-journey.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: deployment manifest, migration/bootstrap commands, non-sensitive health endpoint, real-provider smoke journey.
- Consumes: production database, storage binding, OpenAI, Runway, Resend, Auth.js, encryption, and bootstrap secrets.

- [ ] **Step 1: Write failing production configuration checks**

```ts
test("production journey completes with real configured providers", async ({ page }) => {
  await registerProductionTestUser(page)
  const project = await createProductionProject(page, "Premium fragrance bottle on black glass")
  await expectSequentialImages(page, project, 4)
  await selectNonRecommendedImageWhenAvailable(page)
  await generateAndAssertStoredVideo(page)
})
```

- [ ] **Step 2: Run configuration validation and verify missing-secret failure**

Run: `pnpm playwright test e2e/production-journey.spec.ts`

Expected: FAIL with an explicit list of missing production secrets, not an ambiguous provider error.

- [ ] **Step 3: Add explicit environment contract and idempotent admin bootstrap**

```env
DATABASE_URL=
AUTH_SECRET=
ENCRYPTION_KEY=
NEXT_PUBLIC_APP_URL=
OPENAI_API_KEY=
RUNWAYML_API_SECRET=
RESEND_API_KEY=
EMAIL_FROM=
SUPER_ADMIN_EMAIL=
SUPER_ADMIN_PASSWORD=
```

```ts
await db.user.upsert({
  where: { email: normalizedAdminEmail },
  create: { email: normalizedAdminEmail, passwordHash, role: "SUPER_ADMIN", active: true },
  update: { role: "SUPER_ADMIN", active: true },
})
```

- [ ] **Step 4: Configure hosting, migrate, bootstrap, and deploy**

Link the Vercel project, configure PostgreSQL and R2 credentials through Vercel environment variables, run `prisma migrate deploy`, run the admin bootstrap, build, and deploy through the Vercel CLI or Git integration.

Expected: deployment reaches a terminal successful status and `/api/health` returns core application health without secret values.

- [ ] **Step 5: Run real-provider, authorization, responsive, and leakage checks**

Run: `pnpm playwright test e2e/production-journey.spec.ts`

Expected: one full deployed prompt-to-video project completes; image records become complete strictly in order; the selected image is the Runway source; media resolves from controlled storage; normal users receive `403` from admin APIs.

Inspect built client assets and representative API payloads for `OPENAI_API_KEY`, `RUNWAYML_API_SECRET`, `ENCRYPTION_KEY`, stored credential ciphertext, authorization headers, and bootstrap password. Expected: no matches.

- [ ] **Step 6: Commit verified deployment configuration**

```bash
git add .env.example vercel.json src/app/api/health scripts e2e/production-journey.spec.ts README.md
git commit -m "feat: deploy and verify Adcrevia production"
```

## Production Exit Gate

- [ ] Database migrations and Super Admin bootstrap are idempotent.
- [ ] Provider keys are encrypted, masked, server-only, and absent from logs/client bundles.
- [ ] Password-reset email succeeds without account enumeration.
- [ ] Health, admin, user, image, and video routes enforce their authorization contracts.
- [ ] Real OpenAI and Runway jobs complete and stored assets remain accessible.
- [ ] Desktop, tablet, and mobile smoke journeys pass.
- [ ] The deployed URL is private or public exactly as requested by the user.
