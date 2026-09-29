# Variable Image Counts and FLUX Multi-Scene Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Super Admins set the default image count for new projects, add encrypted BFL configuration for FLUX.2 and FLUX 3, and let users order multiple images into one FLUX 3 multi-scene video.

**Architecture:** Persist the generation policy as a `SystemSetting` and snapshot it onto each `Project`. Keep provider selection behind explicit runtime factories, add focused BFL image/video adapters, store ordered image selections and video sources as join rows, and preserve the existing OpenAI and Runway paths. FLUX 3 receives ordered timestamped keyframes and produces one asynchronous video task; Adcrevia copies the signed result into its own storage before completion.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5.9, Prisma 7/PostgreSQL, Zod 4, Vitest/Testing Library, OpenAI SDK, Runway SDK, native `fetch` for BFL, Cloudflare R2/local storage.

**Spec:** `docs/superpowers/specs/2026-09-17-variable-images-flux-multiscene-design.md`

## Global Constraints

- Default image count is an integer from 1 through 10; the initial fallback is 4.
- A project snapshots the active default at creation; later policy changes never mutate existing projects.
- Image jobs remain sequential within each project.
- A saved selection contains 1 through 10 distinct, completed images from one owned project and preserves explicit order.
- Multiple images require the active BFL video provider; Runway remains single-image only.
- FLUX 3 duration is a whole number from 5 through 20 seconds and allows at least one second between adjacent ordered keyframes.
- Provider keys are server-only, AES-256-GCM encrypted at rest, and represented to clients only by the fixed mask.
- No paid request silently falls back to a different provider after submission starts.
- Existing projects, selections, generated images, and videos must survive migration.
- Before editing Next.js files, read the relevant local guides under `node_modules/next/dist/docs/` as required by `AGENTS.md`.
- BFL integration must follow the current official endpoints: `POST /v1/flux-2-pro`, `POST /v1/flux-3-video`, `GET /v1/credits`, and the returned `polling_url`.

## File Map

- `prisma/schema.prisma`, `prisma/migrations/0003_variable_images_flux_multiscene/migration.sql`: project count snapshot, ordered selections, video source rows, and private provider task metadata.
- `src/features/admin/settings/*`, `src/app/api/admin/settings/generation/route.ts`, `src/components/admin/generation-policy-form.tsx`: validated generation policy read/write and admin control.
- `src/features/admin/providers/*`, `src/app/api/admin/providers/bfl/route.ts`, `src/components/admin/bfl-provider-card.tsx`: BFL dual-kind encrypted configuration and safe credits test.
- `src/lib/providers/configuration.ts`, `src/lib/providers/runtime.ts`: explicit active-provider and OpenAI-text resolution.
- `src/lib/providers/bfl.ts`: shared authenticated BFL request, polling, response parsing, and safe error normalization.
- `src/lib/providers/images/flux.ts`: FLUX.2 image adapter.
- `src/lib/providers/videos/flux.ts`: FLUX 3 keyframe adapter.
- `src/features/projects/*`, `src/features/directions/*`, `src/features/images/*`: dynamic count snapshot, directions, sequential image work, and evaluation.
- `src/features/images/selection.ts`, `src/app/api/projects/[projectId]/image-selection/route.ts`: atomic ordered selection replacement.
- `src/features/videos/*`, `src/app/api/videos/*`: multi-source video orchestration, provider pinning, persistence, and safe API errors.
- `src/components/generation/project-workspace.tsx`, `src/components/images/image-concept-card.tsx`, `src/components/images/image-selection-tray.tsx`: ordered multi-select experience.
- `src/app/dashboard/create/video/page.tsx`, `src/components/videos/video-generator.tsx`: ordered source preview and provider-aware duration/aspect controls.
- `.env.example`, `README.md`, `scripts/smoke-production.ts`: BFL fallback configuration and operational verification.

---

### Task 1: Add the additive database migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0003_variable_images_flux_multiscene/migration.sql`

**Interfaces:**
- Produces: `Project.targetImageCount`, ordered `Project.imageSelections`, `GeneratedVideo.sources`, and private `GeneratedVideo.providerTaskMetadata`.
- Preserves: `Project.selectedImageId` and `GeneratedVideo.sourceImageId` as first-source compatibility pointers.

- [ ] **Step 1: Update the Prisma models**

Change the affected fields and relations to this shape:

```prisma
model Project {
  targetImageCount Int              @default(4)
  imageSelections  ImageSelection[]
}

model GeneratedImage {
  selections   ImageSelection[]
  videoSources GeneratedVideoSource[]
}

model ImageSelection {
  id         String         @id @default(cuid())
  projectId  String
  imageId    String
  position   Int
  selectedAt DateTime       @default(now())
  project    Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  image      GeneratedImage @relation(fields: [imageId], references: [id], onDelete: Cascade)

  @@unique([projectId, imageId])
  @@unique([projectId, position])
  @@index([selectedAt])
}

model GeneratedVideo {
  providerTaskMetadata Json?
  sources              GeneratedVideoSource[]
}

model GeneratedVideoSource {
  id       String         @id @default(cuid())
  videoId  String
  imageId  String
  position Int
  video    GeneratedVideo @relation(fields: [videoId], references: [id], onDelete: Cascade)
  image    GeneratedImage @relation(fields: [imageId], references: [id], onDelete: Restrict)

  @@unique([videoId, imageId])
  @@unique([videoId, position])
  @@index([imageId])
}
```

- [ ] **Step 2: Write the data-preserving SQL migration**

The SQL must:

```sql
ALTER TABLE "Project" ADD COLUMN "targetImageCount" INTEGER NOT NULL DEFAULT 4;
UPDATE "Project" p
SET "targetImageCount" = CASE
  WHEN GREATEST(
    (SELECT COUNT(*) FROM "CreativeDirection" d WHERE d."projectId" = p.id),
    (SELECT COUNT(*) FROM "GeneratedImage" i WHERE i."projectId" = p.id)
  ) = 0 THEN 4
  ELSE LEAST(10, GREATEST(1,
    (SELECT COUNT(*) FROM "CreativeDirection" d WHERE d."projectId" = p.id),
    (SELECT COUNT(*) FROM "GeneratedImage" i WHERE i."projectId" = p.id)
  ))
END;
ALTER TABLE "Project" ADD CONSTRAINT "Project_targetImageCount_check"
  CHECK ("targetImageCount" BETWEEN 1 AND 10);

ALTER TABLE "ImageSelection" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ImageSelection" ADD CONSTRAINT "ImageSelection_position_check"
  CHECK ("position" BETWEEN 1 AND 10);
DROP INDEX "ImageSelection_projectId_key";
DROP INDEX "ImageSelection_imageId_key";
CREATE UNIQUE INDEX "ImageSelection_projectId_imageId_key" ON "ImageSelection"("projectId", "imageId");
CREATE UNIQUE INDEX "ImageSelection_projectId_position_key" ON "ImageSelection"("projectId", "position");

ALTER TABLE "GeneratedVideo" ADD COLUMN "providerTaskMetadata" JSONB;
CREATE TABLE "GeneratedVideoSource" (
  "id" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "imageId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "GeneratedVideoSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GeneratedVideoSource_position_check" CHECK ("position" BETWEEN 1 AND 10)
);
INSERT INTO "GeneratedVideoSource" ("id", "videoId", "imageId", "position")
SELECT 'backfill_' || id, id, "sourceImageId", 1 FROM "GeneratedVideo";
CREATE UNIQUE INDEX "GeneratedVideoSource_videoId_imageId_key" ON "GeneratedVideoSource"("videoId", "imageId");
CREATE UNIQUE INDEX "GeneratedVideoSource_videoId_position_key" ON "GeneratedVideoSource"("videoId", "position");
CREATE INDEX "GeneratedVideoSource_imageId_idx" ON "GeneratedVideoSource"("imageId");
ALTER TABLE "GeneratedVideoSource" ADD CONSTRAINT "GeneratedVideoSource_videoId_fkey"
  FOREIGN KEY ("videoId") REFERENCES "GeneratedVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeneratedVideoSource" ADD CONSTRAINT "GeneratedVideoSource_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "GeneratedImage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

```

Add both unique indexes, the image index, and foreign keys matching the Prisma `onDelete` behavior.

- [ ] **Step 3: Validate and generate Prisma artifacts**

Run: `pnpm prisma validate && pnpm prisma generate`

Expected: both commands exit 0 and the generated client exposes the new fields and model.

- [ ] **Step 4: Apply the migration to the local database and inspect preservation**

Run: `pnpm prisma migrate deploy`

Then query counts before and after with Prisma Studio or `psql`; every existing `ImageSelection` and `GeneratedVideo` must have a position-1 compatibility row.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0003_variable_images_flux_multiscene/migration.sql src/generated/prisma
git commit -m "feat: add ordered generation persistence"
```

### Task 2: Build the generation-policy service, API, and admin control

**Files:**
- Create: `src/features/admin/settings/schemas.ts`
- Create: `src/features/admin/settings/service.ts`
- Create: `src/features/admin/settings/service.test.ts`
- Create: `src/app/api/admin/settings/generation/route.ts`
- Create: `src/components/admin/generation-policy-form.tsx`
- Modify: `src/app/admin/(protected)/settings/page.tsx`

**Interfaces:**
- Produces: `generationPolicySchema`, `getDefaultImageCount()`, `getGenerationPolicy()`, and `saveGenerationPolicy(raw, admin)`.
- Stores: `SystemSetting.key = "generation.defaultImageCount"` with JSON numeric `value`.

- [ ] **Step 1: Write failing service tests**

Cover fallback, boundaries, rejection, and authorization:

```ts
it.each([1, 10])("accepts boundary count %s", async (count) => {
  const repository = { read: vi.fn().mockResolvedValue(null), write: vi.fn().mockResolvedValue(count) }
  await expect(saveGenerationPolicy({ defaultImageCount: count }, admin, repository)).resolves.toEqual({ defaultImageCount: count })
})

it.each([0, 11, 2.5])("rejects invalid count %s", async (count) => {
  await expect(saveGenerationPolicy({ defaultImageCount: count }, admin, repository)).rejects.toThrow()
})

it("falls back to four for missing or invalid storage", async () => {
  await expect(getDefaultImageCount({ read: vi.fn().mockResolvedValue("broken"), write: vi.fn() })).resolves.toBe(4)
})
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `pnpm vitest run src/features/admin/settings/service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement schema and service**

Use:

```ts
export const generationPolicySchema = z.object({
  defaultImageCount: z.number().int().min(1).max(10),
})

export async function getDefaultImageCount(repository = prismaGenerationPolicyRepository) {
  const value = await repository.read("generation.defaultImageCount")
  return z.number().int().min(1).max(10).catch(4).parse(value)
}
```

`saveGenerationPolicy` must require `SUPER_ADMIN`, parse before writing, and return `{ defaultImageCount }`. The Prisma repository uses `systemSetting.findUnique` and `upsert`.

- [ ] **Step 4: Add protected GET and PUT handlers**

Both handlers call `requireSuperAdmin()`. GET returns `{ defaultImageCount }`; PUT maps Zod validation to HTTP 400 with `Default images must be a whole number from 1 to 10.` and otherwise returns the saved policy.

- [ ] **Step 5: Add the client form and replace the hard-coded settings display**

`GenerationPolicyForm` accepts `initialCount`, submits a numeric value to the PUT route, constrains the input with `min={1}`, `max={10}`, `step={1}`, and displays `Applies to newly created projects only.` The server page loads `getGenerationPolicy()` and renders the form while retaining the secret-handling section.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm vitest run src/features/admin/settings/service.test.ts && pnpm tsc --noEmit`

Expected: PASS and exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/features/admin/settings src/app/api/admin/settings/generation src/components/admin/generation-policy-form.tsx "src/app/admin/(protected)/settings/page.tsx"
git commit -m "feat: add admin image count policy"
```

### Task 3: Snapshot and honor dynamic project image counts

**Files:**
- Modify: `src/features/projects/service.ts`
- Modify: `src/features/projects/service.test.ts`
- Modify: `src/features/directions/schemas.ts`
- Modify: `src/features/directions/service.ts`
- Modify: `src/features/directions/service.test.ts`
- Modify: `src/lib/ai/text-provider.ts`
- Modify: `src/lib/ai/openai-text-provider.ts`
- Modify: `src/features/images/orchestrator.ts`
- Modify: `src/features/images/orchestrator.test.ts`
- Modify: `src/features/images/evaluation.ts`
- Modify: `src/features/images/evaluation.test.ts`
- Modify: `src/app/dashboard/projects/[projectId]/page.tsx`
- Modify: `src/components/generation/project-workspace.tsx`

**Interfaces:**
- Consumes: `getDefaultImageCount()` from Task 2.
- Produces: `creativeDirectionsResponseSchema(count)`, `TextIntelligenceProvider.createDirections(input, count)`, and count-aware orchestration/evaluation.

- [ ] **Step 1: Write failing project snapshot tests**

Inject a policy reader into `createProjectDraft` and assert `targetImageCount` is included in the create data. Add a second call with a changed policy and assert the first stored data remains unchanged.

```ts
await createProjectDraft(raw, "user_1", { project: { create } }, async () => 7)
expect(create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ targetImageCount: 7 }),
}))
```

- [ ] **Step 2: Write failing count-aware direction tests**

Change fixtures to test counts 1, 7, and 10. Assert the provider receives the count, persisted positions equal `1..count`, one fewer response is rejected, and duplicate titles still fail.

- [ ] **Step 3: Write failing count-aware image and evaluation tests**

Change the in-memory image repository to return `{ targetImageCount, directions }`. Verify a three-image project creates and processes only three rows sequentially. Evaluation context must include `targetImageCount`; assert three matching evaluations pass and two fail.

- [ ] **Step 4: Run the focused suites and confirm failures**

Run: `pnpm vitest run src/features/projects/service.test.ts src/features/directions/service.test.ts src/features/images/orchestrator.test.ts src/features/images/evaluation.test.ts`

Expected: FAIL on hard-coded count-four behavior.

- [ ] **Step 5: Persist the project snapshot at creation**

Resolve the count before `project.create` and write `targetImageCount`. Keep the default dependency `getDefaultImageCount`; tests inject the policy reader. No subsequent settings lookup is allowed for that project.

- [ ] **Step 6: Make structured directions dynamic**

Replace the constant response schema with:

```ts
export function creativeDirectionsResponseSchema(count: number) {
  return z.object({ directions: z.array(creativeDirectionSchema).length(count) })
}
```

Change the provider interface and OpenAI implementation to `createDirections(input: PromptContext, count: number)`. Build the exact schema inside the method and say `Return exactly ${count} meaningfully different directions.` in the instructions.

- [ ] **Step 7: Make direction persistence use the project snapshot**

Have `getOwnedContext` return `{ context: PromptContext; targetImageCount: number }`. Parse exactly that count, require `Set(titles).size === targetImageCount`, and assign contiguous positions.

- [ ] **Step 8: Make image start and evaluation use the snapshot**

`getOwnedDirections` returns the target count with ordered directions. Replace `FOUR_ORDERED_DIRECTIONS_REQUIRED` with `TARGET_ORDERED_DIRECTIONS_REQUIRED` after comparing against `Array.from({ length: targetImageCount }, ...)`. Evaluation context returns the target count and validates one result for each completed image ID.

- [ ] **Step 9: Render dynamic progress and client loops**

Pass `targetImageCount` from the project page. Build steps with `Array.from({ length: targetImageCount })`, loop at most that many times, change copy to `${targetImageCount} directions`, show `Generate ${targetImageCount} images`, and enable evaluation when completed count equals the snapshot.

- [ ] **Step 10: Run focused tests and typecheck**

Run: `pnpm vitest run src/features/projects/service.test.ts src/features/directions/service.test.ts src/features/images/orchestrator.test.ts src/features/images/evaluation.test.ts && pnpm tsc --noEmit`

Expected: PASS and exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/features/projects src/features/directions src/features/images src/lib/ai src/app/dashboard/projects src/components/generation/project-workspace.tsx
git commit -m "feat: honor per-project image counts"
```

### Task 4: Support kind-specific provider identities and dual BFL configuration

**Files:**
- Modify: `src/features/admin/providers/schemas.ts`
- Modify: `src/features/admin/providers/service.ts`
- Modify: `src/features/admin/providers/service.test.ts`
- Modify: `src/app/api/admin/providers/route.ts`
- Create: `src/app/api/admin/providers/bfl/route.ts`
- Create: `src/app/api/admin/providers/bfl/test/route.ts`
- Create: `src/components/admin/bfl-provider-card.tsx`
- Create: `src/app/admin/(protected)/api-providers/flux/page.tsx`
- Modify: `src/components/navigation/admin-sidebar.tsx`
- Modify: `src/lib/providers/configuration.ts`
- Modify: `src/lib/providers/configuration.test.ts`
- Create: `prisma/migrations/0004_kind_specific_provider_slugs/migration.sql`

**Interfaces:**
- Produces: provider names `OPENAI | RUNWAY | BFL`, slugs `openai-image | runway-video | bfl-image | bfl-video`, `saveBflConfigurations`, and `testBflCredential`.
- Produces: `resolveActiveProvider(kind)` and `resolveOpenAITextSettings()`.

- [ ] **Step 1: Write failing provider service tests**

Assert one BFL save writes two encrypted rows with the same plaintext never appearing in serialized output, independent enabled flags, default models, and kind-specific slugs. Assert the test function sends `GET https://api.bfl.ai/v1/credits` with only an `x-key` header and maps 401/403, 429, and 5xx to the four safe categories.

- [ ] **Step 2: Write failing configuration resolution tests**

Test that active IMAGE can resolve `bfl-image`, active VIDEO can resolve `bfl-video`, OpenAI text resolves the newest decryptable `openai-image` credential independently, and a present but malformed database credential throws instead of falling back.

- [ ] **Step 3: Run focused tests and confirm failures**

Run: `pnpm vitest run src/features/admin/providers/service.test.ts src/lib/providers/configuration.test.ts`

Expected: FAIL because BFL and kind-specific slugs are unsupported.

- [ ] **Step 4: Extend schemas and repository writes**

Add:

```ts
export const bflConfigurationSchema = z.object({
  apiKey: z.string().min(16).max(500),
  imageModel: z.string().trim().regex(/^[a-z0-9.-]+$/).max(100).default("flux-2-pro"),
  videoModel: z.string().trim().regex(/^[a-z0-9.-]+$/).max(100).default("flux-3-video"),
  imageEnabled: z.boolean(),
  videoEnabled: z.boolean(),
})
```

Save both rows in one Prisma transaction, encrypting the submitted key separately for each configuration. When enabling a kind, disable other active configurations of that kind first. Existing OpenAI and Runway writes must use `openai-image` and `runway-video` without changing a provider row's kind. The model regex prevents path separators or query fragments from entering BFL endpoint construction.

- [ ] **Step 5: Migrate legacy provider slugs in the same review gate**

Create a migration containing:

```sql
UPDATE "AIProvider" SET "slug" = 'openai-image' WHERE "slug" = 'openai' AND "kind" = 'IMAGE';
UPDATE "AIProvider" SET "slug" = 'runway-video' WHERE "slug" = 'runway' AND "kind" = 'VIDEO';
```

Until this migration is deployed, repository reads accept both the new slug and its one legacy alias. Remove neither alias in this feature so rolling deployments remain safe.

- [ ] **Step 6: Implement the safe BFL credits test**

Inject `fetch` for testing. Treat a 2xx response with numeric `credits` as `CONNECTED` but never return the balance. Return only `{ ok, category, testedAt }`; never include response text or headers.

- [ ] **Step 7: Add BFL API handlers and admin page**

The POST handler saves both configurations. The test handler only tests the submitted credential. `BflProviderCard` has one password input, two model inputs, two independent checkboxes, Test connection, and Save buttons. Add `/admin/api-providers/flux` to the sidebar as `FLUX / BFL`.

- [ ] **Step 8: Refactor provider resolution**

Define:

```ts
export type ProviderName = "OPENAI" | "RUNWAY" | "BFL"
export type ResolvedProviderSettings = {
  provider: ProviderName
  model: string
  apiKey: string
  endpoint?: string
  source: "database" | "environment"
}
```

`resolveActiveProvider(kind)` selects the newest enabled configuration for that kind and maps its slug. It may use environment fallback only when no enabled database configuration exists. `resolveOpenAITextSettings()` queries the newest decryptable OpenAI image credential regardless of its active flag, then falls back to `OPENAI_API_KEY`; it pairs that credential with `OPENAI_TEXT_MODEL ?? "gpt-5-mini"`, never with the stored image model.

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm vitest run src/features/admin/providers/service.test.ts src/lib/providers/configuration.test.ts && pnpm tsc --noEmit`

Expected: PASS and exit 0.

- [ ] **Step 10: Commit**

```bash
git add prisma/migrations/0004_kind_specific_provider_slugs src/features/admin/providers src/app/api/admin/providers src/components/admin src/app/admin src/components/navigation/admin-sidebar.tsx src/lib/providers/configuration.ts src/lib/providers/configuration.test.ts
git commit -m "feat: add encrypted BFL provider configuration"
```

### Task 5: Add the shared BFL client and FLUX.2 image provider

**Files:**
- Create: `src/lib/providers/bfl.ts`
- Create: `src/lib/providers/bfl.test.ts`
- Create: `src/lib/providers/images/flux.ts`
- Create: `src/lib/providers/images/flux.test.ts`
- Modify: `src/lib/providers/images/types.ts`
- Modify: `src/lib/providers/images/openai.ts`
- Modify: `src/lib/providers/runtime.ts`
- Modify: `src/features/images/orchestrator.ts`
- Modify: `src/features/images/orchestrator.test.ts`
- Modify: `src/app/api/images/generate/route.ts`

**Interfaces:**
- Consumes: `resolveActiveProvider("IMAGE")` from Task 4.
- Produces: `BflClient`, `BflProviderError`, `FluxImageProvider`, and `createActiveImageProvider()`.
- Changes: `ImageGenerationResult` includes `provider` and `model` so persistence never hard-codes OpenAI.

- [ ] **Step 1: Write failing shared-client tests**

Use mocked fetch and fake timers to prove submission reads `{ id, polling_url }`, polling recognizes `Pending | Reasoning | Generating`, `Ready` returns `result.sample`, moderation becomes `PROVIDER_MODERATED`, 401 becomes `PROVIDER_AUTHENTICATION_FAILED`, 429 becomes `PROVIDER_RATE_LIMIT`, and the deadline becomes `PROVIDER_TIMEOUT`.

- [ ] **Step 2: Write failing FLUX.2 adapter tests**

Assert `POST https://api.bfl.ai/v1/flux-2-pro` receives:

```ts
{
  prompt: "Premium product prompt",
  width: 1536,
  height: 1024,
  output_format: "webp",
}
```

Then assert the adapter polls the returned URL, downloads `result.sample` within the signed-URL window, and returns bytes plus `provider: "bfl"`, `model: "flux-2-pro"`, and `providerAssetId`.

- [ ] **Step 3: Run tests and confirm missing adapters**

Run: `pnpm vitest run src/lib/providers/bfl.test.ts src/lib/providers/images/flux.test.ts`

Expected: FAIL because the files do not exist.

- [ ] **Step 4: Implement the BFL client**

Use native fetch with `x-key` and JSON content type. Validate every external payload with narrow Zod schemas. Poll with 1-second initial delay, capped exponential delay of 8 seconds, and a 240-second image deadline. Store no raw bodies and expose only safe error codes and optional HTTP status.

- [ ] **Step 5: Implement FLUX.2 generation and download**

Submit to `/v1/${model}`, poll the returned URL with the API key, fetch the signed sample without forwarding the key, require an `image/*` content type, and return `Uint8Array` bytes. The OpenAI adapter must also return `provider: "openai"` and its configured model.

- [ ] **Step 6: Route image orchestration through the active provider**

`createActiveImageProvider()` returns OpenAI or FLUX based on `resolveActiveProvider("IMAGE")`. Persist `completion.provider` and `completion.model`, removing environment-based hard-coding. Map `BflProviderError.code` into the existing safe failure categories.

- [ ] **Step 7: Run image/provider tests and typecheck**

Run: `pnpm vitest run src/lib/providers/bfl.test.ts src/lib/providers/images/flux.test.ts src/features/images/orchestrator.test.ts && pnpm tsc --noEmit`

Expected: PASS and exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/providers src/features/images/orchestrator.ts src/features/images/orchestrator.test.ts src/app/api/images/generate/route.ts
git commit -m "feat: generate images with FLUX 2"
```

### Task 6: Replace single-image selection with an ordered atomic selection

**Files:**
- Modify: `src/features/images/selection.ts`
- Modify: `src/features/images/selection.test.ts`
- Create: `src/app/api/projects/[projectId]/image-selection/route.ts`
- Delete: `src/app/api/images/[imageId]/select/route.ts`
- Modify: `src/app/api/projects/[projectId]/route.ts`

**Interfaces:**
- Produces: `replaceImageSelection(projectId, imageIds, userId)` returning ordered `{ imageId, position }[]`.
- API: `PUT /api/projects/:projectId/image-selection` with `{ imageIds: string[] }`.

- [ ] **Step 1: Replace single-selection tests with ordered-selection tests**

Test 1 and 10 IDs succeed; duplicates, an empty list, 11 IDs, incomplete images, and cross-project images reject. Assert repository replacement receives deterministic positions and the first ID as compatibility pointer.

```ts
expect(replaceSelection).toHaveBeenCalledWith("project_1", [
  { imageId: "image_3", position: 1 },
  { imageId: "image_1", position: 2 },
], "image_3")
```

- [ ] **Step 2: Run the selection tests and confirm failure**

Run: `pnpm vitest run src/features/images/selection.test.ts`

Expected: FAIL because only `selectImage` exists.

- [ ] **Step 3: Implement validation and atomic replacement**

Parse with `z.array(z.string().cuid()).min(1).max(10)` and reject duplicates. Query all qualifying images in one owner-scoped request; require the returned ID set to match exactly. In one transaction delete existing project selections, create ordered rows, and update `Project.selectedImageId` to the first ID.

- [ ] **Step 4: Add the PUT route and update project serialization**

Map malformed input to 400 and ownership/image mismatch to 404. Return `{ selections }`. Project GET and server page queries must use `imageSelections: { orderBy: { position: "asc" } }`.

- [ ] **Step 5: Remove the obsolete single-select route and verify**

Run: `pnpm vitest run src/features/images/selection.test.ts && pnpm tsc --noEmit`

Expected: PASS and no imports of `/api/images/[imageId]/select` or `selectImage` remain.

- [ ] **Step 6: Commit**

```bash
git add src/features/images/selection.ts src/features/images/selection.test.ts src/app/api/projects
git rm "src/app/api/images/[imageId]/select/route.ts"
git commit -m "feat: persist ordered image selections"
```

### Task 7: Build the ordered multi-select workspace

**Files:**
- Create: `src/components/images/image-selection-tray.tsx`
- Create: `src/components/images/image-selection-tray.test.tsx`
- Modify: `src/components/images/image-concept-card.tsx`
- Modify: `src/components/generation/project-workspace.tsx`
- Modify: `src/app/dashboard/projects/[projectId]/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: ordered initial selections and PUT route from Task 6.
- Produces: local ordered selection state, explicit Save order action, and video CTA after successful persistence.

- [ ] **Step 1: Write failing tray interaction tests**

Render three selected items. Assert order badges show 1/2/3, moving item 3 left produces IDs `[1,3,2]`, removing item 1 produces `[3,2]`, and Save emits the final ordered IDs.

- [ ] **Step 2: Run the component test and confirm failure**

Run: `pnpm vitest run src/components/images/image-selection-tray.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the selection tray**

Render thumbnails, order badges, Move left, Move right, and Remove controls with disabled boundary buttons. Keep the component controlled through `imageIds` and `onChange`; Save calls `onSave(imageIds)`.

- [ ] **Step 4: Convert image cards to toggles**

Replace `Use for video` with `Add to video` / `Remove from video`. Display the selected order number instead of a generic badge. Completed images only are selectable.

- [ ] **Step 5: Wire workspace state and persistence**

Initialize from ordered selection rows. Toggle at the end of the order, cap client state at 10, reorder locally, and PUT the entire array. On success, mark the order saved and show Create video; on failure, retain local state and show a safe message.

- [ ] **Step 6: Add responsive tray styles and verify**

Run: `pnpm vitest run src/components/images/image-selection-tray.test.tsx && pnpm tsc --noEmit`

Expected: PASS and exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/images src/components/generation/project-workspace.tsx src/app/dashboard/projects src/app/globals.css
git commit -m "feat: add ordered multi-image selection UI"
```

### Task 8: Generalize the video provider contract and add FLUX 3

**Files:**
- Modify: `src/lib/providers/videos/types.ts`
- Modify: `src/lib/providers/videos/runway.ts`
- Modify: `src/lib/providers/videos/runway.test.ts`
- Create: `src/lib/providers/videos/flux.ts`
- Create: `src/lib/providers/videos/flux.test.ts`
- Modify: `src/lib/providers/runtime.ts`

**Interfaces:**
- Produces: `VideoSourceImage`, multi-source `VideoGenerationInput`, `VideoCreateResult`, `FluxVideoProvider`, `createActiveVideoProvider()`, and `createVideoProviderForRecord(provider, model)`.
- Preserves: Runway submission for exactly one source.

- [ ] **Step 1: Define the generalized contract and write failing Runway tests**

Use:

```ts
export type VideoSourceImage = { id: string; url: string; position: number }
export type VideoGenerationInput = {
  sourceImages: VideoSourceImage[]
  prompt: string
  duration: number
  aspectRatio: VideoAspectRatio
}
export type VideoCreateResult = { taskId: string; taskMetadata?: Record<string, unknown> }

export interface VideoProvider {
  readonly name: "runway" | "bfl"
  readonly model: string
  create(input: VideoGenerationInput): Promise<VideoCreateResult>
  getStatus(taskId: string, taskMetadata?: Record<string, unknown>): Promise<VideoTaskStatus>
}
```

Assert Runway uses `sourceImages[0].url` for one source and throws a typed `MULTI_IMAGE_REQUIRES_FLUX` error before SDK submission for two.

- [ ] **Step 2: Write failing FLUX 3 keyframe tests**

Assert one image sends its URL as `keyframes`. Assert three images over 10 seconds send:

```ts
[[0, "data:image/webp;base64,one"], [5, "data:image/webp;base64,two"], [10, "data:image/webp;base64,three"]]
```

The body must contain `mode: "i2v"`, `duration: 10`, supported `aspect_ratio`, `resolution: "hd"`, and `generate_audio: true`. Assert the returned `polling_url` is carried only in `taskMetadata`.

- [ ] **Step 3: Write failing FLUX status tests**

Mock the polling URL response. `Pending | Reasoning | Generating` map to queued/running with bounded progress, `Ready` reads `result.sample`, moderation maps to `PROVIDER_MODERATED`, and `Error` maps to `VIDEO_PROVIDER_FAILED`.

- [ ] **Step 4: Run provider tests and confirm failures**

Run: `pnpm vitest run src/lib/providers/videos/runway.test.ts src/lib/providers/videos/flux.test.ts`

Expected: FAIL on the old single-source contract and missing FLUX provider.

- [ ] **Step 5: Implement deterministic timestamps and duration validation**

```ts
export function minimumDurationForSources(count: number) {
  return Math.max(5, count - 1)
}

export function keyframesFor(input: VideoGenerationInput) {
  if (input.sourceImages.length === 1) return input.sourceImages[0].url
  return input.sourceImages.map((image, index) => [
    Number((index * input.duration / (input.sourceImages.length - 1)).toFixed(2)),
    image.url,
  ] as [number, string])
}
```

Reject non-integer/out-of-range duration and duration below the computed minimum.

- [ ] **Step 6: Implement provider factories**

The active factory uses Task 4 resolution. The record factory reconstructs the provider recorded on the video, not whichever provider is currently active. For BFL refresh, `getStatus(taskId, taskMetadata)` requires `taskMetadata.pollingUrl`; for Runway, it ignores metadata and retrieves by task ID.

- [ ] **Step 7: Run provider tests and typecheck**

Run: `pnpm vitest run src/lib/providers/videos/runway.test.ts src/lib/providers/videos/flux.test.ts && pnpm tsc --noEmit`

Expected: PASS and exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/providers/videos src/lib/providers/runtime.ts
git commit -m "feat: add FLUX 3 multi-keyframe provider"
```

### Task 9: Persist ordered video sources and pin each render to its provider

**Files:**
- Modify: `src/features/videos/schemas.ts`
- Modify: `src/features/videos/service.ts`
- Modify: `src/features/videos/service.test.ts`
- Modify: `src/app/api/videos/generate/route.ts`
- Modify: `src/app/api/videos/[videoId]/refresh/route.ts`

**Interfaces:**
- Consumes: ordered selections from Task 6 and provider factories from Task 8.
- Produces: idempotent multi-source video records with ordered `GeneratedVideoSource` rows.

- [ ] **Step 1: Rewrite service tests around ordered sources**

Test no selection fails, Runway with two sources fails before submission, FLUX gets ordered prepared images, reordering IDs changes the idempotency hash, identical order returns the existing video, create writes all source rows, and refresh reconstructs the provider recorded on the video.

- [ ] **Step 2: Add duration and aspect-ratio schema tests**

Accept whole durations 5 and 20; reject 4, 21, and 7.5. Keep a union of provider-supported aspect ratios and validate the selected provider capability before submission. BFL supports `16:9`, `9:16`, `1:1`, `4:3`, `3:4`; Runway supports `16:9`, `9:16`, `1:1`, `4:5`.

- [ ] **Step 3: Run service tests and confirm failures**

Run: `pnpm vitest run src/features/videos/service.test.ts`

Expected: FAIL because the service loads one image and hard-codes Runway.

- [ ] **Step 4: Load and prepare ordered source images**

Replace `getSelectedImage` with `getSelectedImages`, ordered by `position`. Require 1–10 rows and prepare every URL through `prepareImageForProvider`. Resolve the active provider before hashing.

- [ ] **Step 5: Build the provider-pinned idempotency key**

Hash exactly:

```ts
{
  projectId,
  sourceImageIds: selectedImages.map(({ id }) => id),
  prompt,
  motionStyle,
  duration,
  aspectRatio,
  provider: resolved.name,
  model: resolved.model,
}
```

This makes reordered sources an intentional new render.

- [ ] **Step 6: Persist video and sources atomically**

Create `GeneratedVideo` with first source compatibility ID, actual provider/model, task ID, private task metadata, and then nested-create `sources` at positions 1..n. Update project status in the same transaction.

- [ ] **Step 7: Refresh through the recorded provider**

Select provider, model, and metadata in `getOwnedVideo`; construct the corresponding provider with the stored values. Never use the currently active provider to refresh an existing task. Copy a successful signed MP4 to storage before marking completion.

- [ ] **Step 8: Map safe route errors**

Return 422 with code `MULTI_IMAGE_REQUIRES_FLUX`, 422 for missing selection, 400 for input/capability errors, 503 for absent provider/storage configuration, and 502 for upstream failures. Do not expose provider bodies, polling URLs, or keys.

- [ ] **Step 9: Run service tests and typecheck**

Run: `pnpm vitest run src/features/videos/service.test.ts && pnpm tsc --noEmit`

Expected: PASS and exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/features/videos src/app/api/videos
git commit -m "feat: orchestrate multi-source video renders"
```

### Task 10: Update the video creation experience for multiple scenes

**Files:**
- Modify: `src/app/dashboard/create/video/page.tsx`
- Modify: `src/components/videos/video-generator.tsx`
- Create: `src/components/videos/video-generator.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: ordered selections and active provider capability.
- Produces: source storyboard preview, computed minimum duration, and one-render messaging.

- [ ] **Step 1: Write failing component tests**

Render three ordered sources. Assert all thumbnails appear with scene numbers, minimum duration is 5, selecting ten sources raises minimum duration to 9, submitted payload contains the chosen duration but no client-supplied image IDs, and `MULTI_IMAGE_REQUIRES_FLUX` renders an actionable admin/provider message.

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm vitest run src/components/videos/video-generator.test.tsx`

Expected: FAIL because the component accepts one URL.

- [ ] **Step 3: Query ordered selections and active provider on the server page**

Load `imageSelections` with completed images ordered by position. Pass `{ id, url, position }[]`, the active provider name, and its supported aspect ratios to the client. Do not pass credentials or polling metadata.

- [ ] **Step 4: Render the ordered storyboard and duration controls**

Replace the single image aside with a horizontal storyboard labeled Scene 1..n. Generate duration options for every whole second from `Math.max(5, count - 1)` through 20. Explain that FLUX produces one continuous multi-scene video; for Runway plus multiple sources, disable submission with the safe configuration message.

- [ ] **Step 5: Submit and poll without changing the existing ownership boundary**

The POST body remains project-scoped and contains prompt, motion style, duration, and aspect ratio only. The server derives authoritative image rows. Keep visibility-aware polling and final `VideoPlayer` behavior.

- [ ] **Step 6: Run component tests and typecheck**

Run: `pnpm vitest run src/components/videos/video-generator.test.tsx && pnpm tsc --noEmit`

Expected: PASS and exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/create/video/page.tsx src/components/videos/video-generator.tsx src/components/videos/video-generator.test.tsx src/app/globals.css
git commit -m "feat: add multi-scene video creation UI"
```

### Task 11: Document, smoke-test, and verify the complete workflow

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `scripts/smoke-production.ts`
- Create: `src/app/api/admin/settings/generation/route.test.ts`
- Create: `src/app/api/projects/[projectId]/image-selection/route.test.ts`
- Create: `src/app/api/videos/generate/route.test.ts`

**Interfaces:**
- Verifies: admin policy, project snapshot, dynamic generation, ordered selection, BFL configuration, one FLUX video task, and migration compatibility.

- [ ] **Step 1: Add safe environment fallbacks and documentation**

Document server-only `BFL_API_KEY`, `BFL_IMAGE_MODEL=flux-2-pro`, and `BFL_VIDEO_MODEL=flux-3-video`. Explain that database provider configuration takes precedence, that provider tests never expose credits/key fragments, and that production needs durable media storage.

- [ ] **Step 2: Extend the production smoke script**

Add checks that `generation.defaultImageCount` is readable, active provider rows use kind-specific slugs, no provider response contains `encryptedCredential`, ordered selections have unique positions, and generated videos with sources preserve contiguous order. Scan structured generation logs and assert they contain only provider, model, task ID, duration, correlation ID, and safe error code fields—never headers, API keys, base64 media, polling URLs, or raw provider bodies.

- [ ] **Step 3: Add route-level acceptance coverage**

Mock authentication and service boundaries, then assert the exact HTTP contracts:

```ts
import { PUT as putGenerationPolicy } from "@/app/api/admin/settings/generation/route"
import { PUT as putSelection } from "@/app/api/projects/[projectId]/image-selection/route"
import { POST as postVideo } from "@/app/api/videos/generate/route"

const policyResponse = await putGenerationPolicy(new Request("http://app/api/admin/settings/generation", {
  method: "PUT",
  body: JSON.stringify({ defaultImageCount: 3 }),
}))
expect(policyResponse.status).toBe(200)

const selectionResponse = await putSelection(
  new Request("http://app/api/projects/project_1/image-selection", {
    method: "PUT",
    body: JSON.stringify({ imageIds: ["image_3", "image_1"] }),
  }),
  { params: Promise.resolve({ projectId: "project_1" }) },
)
expect(selectionResponse.status).toBe(200)

const videoResponse = await postVideo(new Request("http://app/api/videos/generate", {
  method: "POST",
  body: JSON.stringify({
    projectId: "project_1",
    prompt: "Move through both product scenes with controlled cinematic cuts.",
    motionStyle: "CINEMATIC",
    duration: 5,
    aspectRatio: "16:9",
  }),
}))
expect(videoResponse.status).toBe(201)
```

The provider/service tests from Tasks 5, 8, and 9 must additionally assert exactly one FLUX submission whose timestamped keyframes preserve order `image_3`, then `image_1`. Route tests must also assert invalid counts return 400, ownership mismatch returns 404, and `MULTI_IMAGE_REQUIRES_FLUX` returns 422 without calling the provider.

- [ ] **Step 4: Run the full unit and integration suite**

Run: `pnpm test`

Expected: all Vitest files pass.

- [ ] **Step 5: Run static and production checks**

Run: `pnpm tsc --noEmit && pnpm build && pnpm smoke:production`

Expected: all commands exit 0; build logs contain no leaked key material.

- [ ] **Step 6: Perform manual acceptance with real provider credentials**

Set admin count to 3, create a new project, verify exactly 3 sequential images, select at least 2 in a non-default order, generate one FLUX 3 video, and verify the stored source rows and final MP4. Repeat with Runway active and verify two sources are rejected before a provider call while one source succeeds.

- [ ] **Step 7: Commit**

```bash
git add .env.example README.md scripts/smoke-production.ts src/app/api/admin/settings/generation src/app/api/projects src/app/api/videos
git commit -m "test: verify variable image and FLUX workflow"
```

## Official Provider References

- FLUX.2 text-to-image and polling: https://docs.bfl.ai/flux_2/flux2_text_to_image
- FLUX 3 video modes and timestamped keyframes: https://docs.bfl.ai/flux_3/flux3_video
- FLUX 3 API request and response: https://docs.bfl.ai/api-reference/utility/generate-a-video-with-flux-3
- BFL credits connection check: https://docs.bfl.ai/api-reference/get-the-users-credits
- BFL asynchronous result states: https://docs.bfl.ai/api-reference/utility/get-result
