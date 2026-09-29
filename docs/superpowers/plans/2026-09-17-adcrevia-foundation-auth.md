# Adcrevia Foundation and Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a deployable Adcrevia application foundation with PostgreSQL persistence, secure authentication, role enforcement, encrypted provider configuration, and premium responsive shells.

**Architecture:** Use a Next.js App Router modular monolith. Server modules own database, authentication, authorization, encryption, and validation; route groups provide distinct marketing, user, and admin surfaces while sharing typed primitives.

**Tech Stack:** Next.js, TypeScript, React, Tailwind CSS, shadcn/ui, Framer Motion, Vitest, Playwright, Auth.js, Prisma, Neon PostgreSQL, Zod, Argon2id.

**Spec:** `docs/superpowers/specs/2026-09-17-adcrevia-design.md`

## Global Constraints

- Use Sora for headings and Inter for body text through `next/font`.
- Use `USER` and `SUPER_ADMIN` roles.
- Keep authentication, authorization, and credential handling server-side.
- Use authenticated encryption for provider API keys.
- Never return password hashes, tokens, API keys, or encryption material from an API.
- Use server components unless client interactivity requires otherwise.

---

### Task 1: Application Foundation and Visual System

**Files:**
- Create: `package.json`
- Create: `next.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/app/(marketing)/page.tsx`
- Create: `src/app/(marketing)/features/page.tsx`
- Create: `src/app/(marketing)/pricing/page.tsx`
- Create: `src/components/brand/adcrevia-mark.tsx`
- Create: `public/favicon.svg`
- Test: `src/components/brand/adcrevia-mark.test.tsx`

**Interfaces:**
- Produces: shared CSS tokens, root metadata, `AdcreviaMark({ compact?: boolean })`, test/build scripts.
- Consumes: no earlier application task.

- [ ] **Step 1: Scaffold the Cloudflare-compatible Next.js starter and install declared dependencies**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 2: Write the failing brand-shell test**

```tsx
it("renders the Adcrevia product name and accessible home link", () => {
  render(<AdcreviaMark />)
  expect(screen.getByRole("link", { name: /adcrevia home/i })).toHaveTextContent("Adcrevia")
})
```

- [ ] **Step 3: Run the focused test and verify failure**

Run: `pnpm vitest run src/components/brand/adcrevia-mark.test.tsx`

Expected: FAIL because `AdcreviaMark` does not exist.

- [ ] **Step 4: Implement tokens, fonts, metadata, favicon, brand mark, landing page, feature page, and pricing page**

```tsx
export function AdcreviaMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" aria-label="Adcrevia home" className="inline-flex items-center gap-3">
      <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">A</span>
      {!compact && <span className="font-display text-lg font-semibold">Adcrevia</span>}
    </Link>
  )
}
```

- [ ] **Step 5: Verify foundation and commit**

Run: `pnpm vitest run src/components/brand/adcrevia-mark.test.tsx && pnpm build`

Expected: test PASS and production build succeeds.

```bash
git add package.json next.config.ts vitest.config.ts playwright.config.ts src/app src/components/brand public/favicon.svg
git commit -m "feat: establish Adcrevia application foundation"
```

### Task 2: Prisma Domain Schema and Database Access

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/migrations/0001_initial/migration.sql`
- Create: `src/lib/db/prisma.ts`
- Create: `src/lib/db/project-repository.ts`
- Test: `src/lib/db/project-repository.test.ts`

**Interfaces:**
- Produces: `getPrisma()`, `createDraftProject(input)`, all enums and models defined by the spec.
- Consumes: `DATABASE_URL`.

- [ ] **Step 1: Write the failing repository contract test**

```ts
it("creates a draft owned by the supplied user", async () => {
  const project = await createDraftProject({ userId: user.id, name: "Perfume launch", prompt: "Luxury perfume" })
  expect(project).toMatchObject({ userId: user.id, status: "DRAFT", name: "Perfume launch" })
})
```

- [ ] **Step 2: Run the test and verify the missing schema/repository failure**

Run: `pnpm vitest run src/lib/db/project-repository.test.ts`

Expected: FAIL because the Prisma client and repository are missing.

- [ ] **Step 3: Define the complete relational schema and indexes**

```prisma
enum Role { USER SUPER_ADMIN }
enum ProjectStatus { DRAFT GENERATING IMAGES_READY VIDEO_GENERATING COMPLETED FAILED }
enum ImageStatus { PENDING GENERATING COMPLETED FAILED }
enum VideoStatus { PENDING PROCESSING COMPLETED FAILED }

model Project {
  id        String        @id @default(cuid())
  userId    String
  name      String
  status    ProjectStatus @default(DRAFT)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  prompt    Prompt?
  images    GeneratedImage[]
  videos    GeneratedVideo[]
  @@index([userId, createdAt])
  @@index([status, createdAt])
}
```

Include every model named in the design spec plus `VerificationToken` and `PasswordResetToken`, with foreign keys and indexes for `userId`, `projectId`, `createdAt`, `status`, and provider task IDs.

- [ ] **Step 4: Implement per-request database access and repository**

```ts
export async function createDraftProject(input: { userId: string; name: string; prompt: string }) {
  const db = getPrisma()
  return db.project.create({
    data: { userId: input.userId, name: input.name, prompt: { create: { original: input.prompt } } },
  })
}
```

- [ ] **Step 5: Migrate, test, and commit**

Run: `pnpm prisma migrate deploy && pnpm vitest run src/lib/db/project-repository.test.ts`

Expected: migration succeeds and test PASS.

```bash
git add prisma src/lib/db
git commit -m "feat: add Adcrevia persistence model"
```

### Task 3: Registration, Sessions, and Role Enforcement

**Files:**
- Create: `src/lib/auth/config.ts`
- Create: `src/lib/auth/password.ts`
- Create: `src/lib/auth/guards.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/(auth)/register/page.tsx`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/admin/login/page.tsx`
- Test: `src/lib/auth/guards.test.ts`
- Test: `src/app/api/auth/register/route.test.ts`

**Interfaces:**
- Produces: `auth()`, `requireUser()`, `requireSuperAdmin()`, `hashPassword()`, `verifyPassword()`.
- Consumes: Prisma `User`, `Session`, and role fields.

- [ ] **Step 1: Write failing authorization tests**

```ts
it("rejects a normal user from a super-admin guard", async () => {
  await expect(requireSuperAdmin(sessionFor("USER"))).rejects.toMatchObject({ status: 403 })
})

it("allows a super admin", async () => {
  await expect(requireSuperAdmin(sessionFor("SUPER_ADMIN"))).resolves.toMatchObject({ role: "SUPER_ADMIN" })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run src/lib/auth/guards.test.ts src/app/api/auth/register/route.test.ts`

Expected: FAIL because auth services and route are missing.

- [ ] **Step 3: Implement credentials authentication and registration validation**

```ts
export async function requireSuperAdmin(session = await auth()) {
  if (!session?.user) throw new HttpError(401, "Authentication required")
  if (session.user.role !== "SUPER_ADMIN") throw new HttpError(403, "Forbidden")
  if (!session.user.active) throw new HttpError(403, "Account inactive")
  return session.user
}
```

Use Argon2id hashing, normalized unique email addresses, generic login failures, secure cookies, and no password fields in session payloads.

- [ ] **Step 4: Implement accessible register, user login, and admin login pages**

```tsx
<form action={registerAction} aria-describedby="registration-errors">
  <Label htmlFor="email">Email</Label>
  <Input id="email" name="email" type="email" autoComplete="email" required />
  <PasswordFields />
  <Button type="submit">Create account</Button>
</form>
```

- [ ] **Step 5: Test protected sessions and commit**

Run: `pnpm vitest run src/lib/auth/guards.test.ts src/app/api/auth/register/route.test.ts`

Expected: PASS for normal, admin, inactive, invalid-registration, and duplicate-email cases.

```bash
git add src/lib/auth src/app/api/auth src/app/\(auth\) src/app/admin/login
git commit -m "feat: add secure user and admin authentication"
```

### Task 4: Credential Encryption and Protected Application Shells

**Files:**
- Create: `src/lib/encryption/provider-credentials.ts`
- Create: `src/lib/encryption/provider-credentials.test.ts`
- Create: `src/app/dashboard/layout.tsx`
- Create: `src/app/dashboard/page.tsx`
- Create: `src/app/dashboard/settings/page.tsx`
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`
- Create: `src/components/navigation/dashboard-sidebar.tsx`
- Create: `src/components/navigation/admin-sidebar.tsx`
- Test: `src/app/dashboard/access.test.ts`
- Test: `src/app/admin/access.test.ts`

**Interfaces:**
- Produces: `encryptCredential(plaintext)`, `decryptCredential(payload)`, protected user and admin layouts.
- Consumes: `requireUser()`, `requireSuperAdmin()`, `ENCRYPTION_KEY`.

- [ ] **Step 1: Write failing encryption and access tests**

```ts
it("round-trips with authenticated encryption and never includes plaintext", () => {
  const encrypted = encryptCredential("sk-secret")
  expect(JSON.stringify(encrypted)).not.toContain("sk-secret")
  expect(decryptCredential(encrypted)).toBe("sk-secret")
})
```

- [ ] **Step 2: Verify tests fail before implementation**

Run: `pnpm vitest run src/lib/encryption/provider-credentials.test.ts src/app/dashboard/access.test.ts src/app/admin/access.test.ts`

Expected: FAIL because encryption and protected layouts do not exist.

- [ ] **Step 3: Implement AES-256-GCM credential encryption**

```ts
export type EncryptedCredential = { version: 1; iv: string; tag: string; ciphertext: string }

export function encryptCredential(plaintext: string): EncryptedCredential {
  const key = readEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }
}
```

- [ ] **Step 4: Implement protected responsive user/admin shells**

```tsx
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireSuperAdmin()
  return <AdminShell>{children}</AdminShell>
}
```

Use semantic navigation, responsive drawers, visible focus, active-route indication, reduced-motion-safe transitions, and no sensitive session fields in client props. The dashboard page contains project/image/video/generation totals and recent project thumbnails; settings contains profile and session controls without exposing authentication internals.

- [ ] **Step 5: Test, build, and commit**

Run: `pnpm vitest run src/lib/encryption/provider-credentials.test.ts src/app/dashboard/access.test.ts src/app/admin/access.test.ts && pnpm build`

Expected: all tests PASS and build succeeds.

```bash
git add src/lib/encryption src/app/dashboard src/app/admin src/components/navigation
git commit -m "feat: protect Adcrevia application shells"
```

## Foundation Exit Gate

- [ ] Register and log in with a user account.
- [ ] Verify user routes redirect anonymous visitors.
- [ ] Verify normal users receive `403` from admin guards.
- [ ] Verify encrypted provider values round-trip and browser payloads never contain plaintext.
- [ ] Run: `pnpm test && pnpm build`.
