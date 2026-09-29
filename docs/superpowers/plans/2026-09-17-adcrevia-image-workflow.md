# Adcrevia Image Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete prompt-to-four-images workflow with persisted inputs, safe website analysis, sequential generation, evaluation, selection, and recovery.

**Architecture:** Route handlers validate and persist intent, while service modules own analysis and state transitions. An image-provider interface normalizes OpenAI behavior; a storage interface copies provider output into controlled storage before records become complete.

**Tech Stack:** Next.js, TypeScript, Prisma, Zod, OpenAI SDK, object storage, Vitest, Playwright, Framer Motion.

**Spec:** `docs/superpowers/specs/2026-09-17-adcrevia-design.md`

## Global Constraints

- Generate exactly four structured creative directions.
- Generate image 01, then 02, then 03, then 04.
- Persist every transition and retain completed siblings after failure.
- Block private/internal website targets and revalidate redirects.
- Store generated files outside PostgreSQL.
- Never expose OpenAI credentials or raw provider errors to users.
- Never fabricate progress percentages.

---

### Task 1: Project Input, Palette, and Safe Website Analysis

**Files:**
- Create: `src/features/projects/schemas.ts`
- Create: `src/features/projects/service.ts`
- Create: `src/features/website/url-policy.ts`
- Create: `src/features/website/analyzer.ts`
- Create: `src/app/api/website/analyze/route.ts`
- Create: `src/app/dashboard/create/page.tsx`
- Create: `src/components/generation/prompt-editor.tsx`
- Create: `src/components/generation/website-analyzer.tsx`
- Create: `src/components/generation/color-palette-picker.tsx`
- Test: `src/features/website/url-policy.test.ts`
- Test: `src/features/projects/service.test.ts`

**Interfaces:**
- Produces: `projectInputSchema`, `createProjectDraft(input, userId)`, `assertPublicHttpUrl(url)`, `analyzeWebsite(url)`.
- Consumes: `createDraftProject()` and authenticated user guard.

- [ ] **Step 1: Write failing URL-policy and project-input tests**

```ts
it.each(["http://127.0.0.1", "http://169.254.169.254", "http://10.0.0.8", "file:///etc/passwd"])(
  "rejects non-public target %s",
  async (url) => expect(assertPublicHttpUrl(url)).rejects.toThrow("PUBLIC_HTTP_URL_REQUIRED"),
)

it("normalizes a validated palette", () => {
  expect(projectInputSchema.parse({ prompt: "Luxury watch", brandPalette: ["#fff", "#C9A227"] }).brandPalette)
    .toEqual(["#FFFFFF", "#C9A227"])
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run src/features/website/url-policy.test.ts src/features/projects/service.test.ts`

Expected: FAIL because schemas and URL policy are missing.

- [ ] **Step 3: Implement schemas and SSRF-resistant URL validation**

```ts
export const projectInputSchema = z.object({
  prompt: z.string().trim().min(12).max(4000),
  websiteUrl: z.string().url().optional().or(z.literal("")),
  brandPalette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).max(8).default([]),
})
```

Resolve DNS, reject loopback/private/link-local/reserved addresses, allow only HTTP/S, re-run validation after every redirect, accept HTML only, cap redirects at three, body size at 2 MB, and timeout at eight seconds.

- [ ] **Step 4: Implement persisted draft creation and accessible create form**

```ts
export async function createProjectDraft(raw: unknown, userId: string) {
  const input = projectInputSchema.parse(raw)
  return db.project.create({
    data: {
      userId,
      name: deriveProjectName(input.prompt),
      prompt: { create: { original: input.prompt } },
      websiteReference: input.websiteUrl ? { create: { url: input.websiteUrl, status: "PENDING" } } : undefined,
      brandPalette: { create: input.brandPalette.map((hex, index) => ({ hex, position: index })) },
    },
  })
}
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run src/features/website/url-policy.test.ts src/features/projects/service.test.ts`

Expected: PASS for invalid URLs, redirect revalidation, palette normalization, and persisted drafts.

```bash
git add src/features/projects src/features/website src/app/api/website src/app/dashboard/create src/components/generation
git commit -m "feat: add safe creative project intake"
```

### Task 2: Prompt Enhancement and Four Creative Directions

**Files:**
- Create: `src/lib/ai/text-provider.ts`
- Create: `src/lib/ai/openai-text-provider.ts`
- Create: `src/features/directions/schemas.ts`
- Create: `src/features/directions/service.ts`
- Create: `src/app/api/ai/enhance-prompt/route.ts`
- Create: `src/app/api/ai/creative-directions/route.ts`
- Create: `src/app/api/ai/palette/route.ts`
- Create: `src/components/generation/creative-direction-card.tsx`
- Test: `src/features/directions/service.test.ts`

**Interfaces:**
- Produces: `TextIntelligenceProvider`, `enhancePrompt(projectId, userId)`, `suggestPalette(projectId, userId)`, `createDirections(projectId, userId)`.
- Consumes: persisted prompt, website analysis, palette, server-held OpenAI credential.

- [ ] **Step 1: Write the failing exact-four-directions test**

```ts
it("persists exactly four distinct structured directions", async () => {
  textProvider.generateObject.mockResolvedValue({ directions: directionFixtures(4) })
  const result = await createDirections(project.id, user.id)
  expect(result).toHaveLength(4)
  expect(new Set(result.map((item) => item.title)).size).toBe(4)
  expect(result.map((item) => item.position)).toEqual([1, 2, 3, 4])
})
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run src/features/directions/service.test.ts`

Expected: FAIL because provider and direction service are missing.

- [ ] **Step 3: Define structured provider and direction schemas**

```ts
export const creativeDirectionSchema = z.object({
  title: z.string().min(2).max(80),
  description: z.string().min(20).max(500),
  environment: z.string(),
  lighting: z.string(),
  composition: z.string(),
  cameraDirection: z.string(),
  mood: z.string(),
  colorTreatment: z.string(),
  imagePrompt: z.string().min(30).max(4000),
})

export interface TextIntelligenceProvider {
  enhancePrompt(input: PromptContext): Promise<string>
  suggestPalette(input: PromptContext): Promise<string[]>
  createDirections(input: PromptContext): Promise<CreativeDirectionInput[]>
  evaluateImages(input: ImageEvaluationInput): Promise<ImageEvaluationInputResult[]>
}
```

- [ ] **Step 4: Implement OpenAI adapter and transactional persistence**

```ts
const directions = z.array(creativeDirectionSchema).length(4).parse(
  await provider.createDirections(context),
)
return db.$transaction(
  directions.map((direction, index) => db.creativeDirection.create({
    data: { ...direction, projectId, position: index + 1 },
  })),
)
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run src/features/directions/service.test.ts`

Expected: PASS for prompt enhancement, a validated AI palette, four valid directions, malformed provider output rejection, ownership, and idempotent retry.

```bash
git add src/lib/ai src/features/directions src/app/api/ai src/components/generation/creative-direction-card.tsx
git commit -m "feat: generate structured creative directions"
```

### Task 3: Sequential Image State Machine and Provider Adapter

**Files:**
- Create: `src/lib/providers/images/types.ts`
- Create: `src/lib/providers/images/openai.ts`
- Create: `src/lib/storage/types.ts`
- Create: `src/lib/storage/r2.ts`
- Create: `src/features/images/state-machine.ts`
- Create: `src/features/images/orchestrator.ts`
- Create: `src/app/api/images/generate/route.ts`
- Create: `src/app/api/images/[imageId]/route.ts`
- Create: `src/app/api/images/[imageId]/retry/route.ts`
- Test: `src/features/images/orchestrator.test.ts`

**Interfaces:**
- Produces: `ImageProvider.generateImage(input)`, `StorageProvider.put(input)`, `startImageRun(projectId, userId)`, `processNextImage(projectId)`.
- Consumes: four persisted directions, active decrypted image-provider configuration.

- [ ] **Step 1: Write the failing sequential-order test**

```ts
it("never generates image 02 before image 01 completes", async () => {
  await startImageRun(project.id, user.id)
  expect(await currentStatuses(project.id)).toEqual(["PENDING", "PENDING", "PENDING", "PENDING"])
  await processNextImage(project.id)
  expect(imageProvider.generateImage).toHaveBeenCalledTimes(1)
  expect(imageProvider.generateImage.mock.calls[0][0].position).toBe(1)
  expect(await currentStatuses(project.id)).toEqual(["COMPLETED", "PENDING", "PENDING", "PENDING"])
})
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run src/features/images/orchestrator.test.ts`

Expected: FAIL because the state machine and provider interfaces are missing.

- [ ] **Step 3: Implement provider/storage contracts and legal transitions**

```ts
export interface ImageProvider {
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult>
}

export interface StorageProvider {
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<{ url: string; etag?: string }>
  copyRemote(input: { key: string; sourceUrl: string }): Promise<{ url: string; etag?: string }>
  delete(key: string): Promise<void>
}

const imageTransitions = {
  PENDING: ["GENERATING"],
  GENERATING: ["COMPLETED", "FAILED"],
  FAILED: ["PENDING"],
  COMPLETED: [],
} as const
```

- [ ] **Step 4: Implement leased sequential orchestration**

```ts
export async function processNextImage(projectId: string) {
  const image = await claimNextPendingImage(projectId)
  if (!image) return summarizeImageRun(projectId)
  try {
    const generated = await imageProviderFor(image).generateImage(toProviderInput(image))
    const stored = await storage.put(toStorageInput(image, generated))
    await completeImage(image.id, generated, stored)
  } catch (error) {
    await failImage(image.id, normalizeProviderError(error))
  }
  return summarizeImageRun(projectId)
}
```

Use a transaction and project-scoped lease so concurrent requests cannot claim different pending images while another is `GENERATING`. A retry changes only the failed record back to `PENDING`.

- [ ] **Step 5: Verify, build, and commit**

Run: `pnpm vitest run src/features/images/orchestrator.test.ts && pnpm build`

Expected: PASS for strict order, concurrency, partial failure, retry, provider error sanitization, and stored media metadata.

```bash
git add src/lib/providers/images src/lib/storage src/features/images src/app/api/images
git commit -m "feat: orchestrate sequential image generation"
```

### Task 4: Progress Gallery, Evaluation, Selection, and Recovery

**Files:**
- Create: `src/features/images/evaluation.ts`
- Create: `src/features/images/selection.ts`
- Create: `src/app/api/ai/evaluate-images/route.ts`
- Create: `src/app/api/images/[imageId]/select/route.ts`
- Create: `src/app/api/projects/route.ts`
- Create: `src/app/api/projects/[projectId]/route.ts`
- Create: `src/app/dashboard/projects/page.tsx`
- Create: `src/app/dashboard/projects/[projectId]/page.tsx`
- Create: `src/app/dashboard/generations/page.tsx`
- Create: `src/components/dashboard/project-card.tsx`
- Create: `src/components/generation/generation-progress.tsx`
- Create: `src/components/images/image-concept-card.tsx`
- Create: `src/components/images/image-preview-modal.tsx`
- Create: `src/components/images/ai-recommendation-badge.tsx`
- Test: `src/features/images/evaluation.test.ts`
- Test: `src/features/images/selection.test.ts`
- Test: `e2e/image-workflow.spec.ts`

**Interfaces:**
- Produces: `evaluateProjectImages(projectId)`, `selectImage(projectId, imageId, userId)`, owned project list/search/rename/delete, project workspace UI, generation gallery filters.
- Consumes: four completed stored images and `TextIntelligenceProvider.evaluateImages()`.

- [ ] **Step 1: Write failing evaluation and override tests**

```ts
it("marks the highest score as recommended without selecting it", async () => {
  const result = await evaluateProjectImages(project.id)
  expect(result.filter((item) => item.recommended)).toHaveLength(1)
  expect(await selectedImage(project.id)).toBeNull()
})

it("allows the owner to select a non-recommended completed image", async () => {
  await selectImage(project.id, completedImage.id, user.id)
  expect((await selectedImage(project.id))?.imageId).toBe(completedImage.id)
})

it("rejects rename and delete attempts from a non-owner", async () => {
  await expect(renameProject(project.id, "Stolen", anotherUser.id)).rejects.toMatchObject({ status: 404 })
  await expect(deleteProject(project.id, anotherUser.id)).rejects.toMatchObject({ status: 404 })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run src/features/images/evaluation.test.ts src/features/images/selection.test.ts`

Expected: FAIL because evaluation and selection services are missing.

- [ ] **Step 3: Implement validated evaluation and explicit selection**

```ts
export async function selectImage(projectId: string, imageId: string, userId: string) {
  const image = await requireOwnedCompletedImage({ projectId, imageId, userId })
  return db.imageSelection.upsert({
    where: { projectId },
    create: { projectId, imageId: image.id, selectedById: userId },
    update: { imageId: image.id, selectedById: userId },
  })
}
```

Evaluation accepts exactly one normalized result per completed image, clamps scores to `0..100`, stores strengths/reasoning, and marks exactly one recommendation. Project list, rename, delete, search, and generation-gallery queries always scope by authenticated owner; deletion requires the confirmation UI and cascades database records plus queued storage cleanup.

- [ ] **Step 4: Implement truthful progressive gallery and preview dialog**

```tsx
<GenerationProgress
  steps={images.map((image) => ({
    label: `Generating Image ${String(image.position).padStart(2, "0")}`,
    state: toProgressState(image.status),
  }))}
/>
```

Poll project status with bounded backoff, stop when the run is terminal, reveal completed images progressively, show an indeterminate animation for active work, and expose retry only for failed records.

- [ ] **Step 5: Run integration and browser tests, then commit**

Run: `pnpm vitest run src/features/images/evaluation.test.ts src/features/images/selection.test.ts && pnpm playwright test e2e/image-workflow.spec.ts`

Expected: PASS for sequential visual reveal, recommendation, manual override, project search/rename/delete ownership, image/video generation filters, preview, refresh recovery, and partial retry.

```bash
git add src/features/images src/app/api/ai/evaluate-images src/app/api/images src/app/dashboard/projects src/components/images src/components/generation e2e/image-workflow.spec.ts
git commit -m "feat: complete image evaluation and selection workflow"
```

## Image Workflow Exit Gate

- [ ] Create a project with prompt only, prompt plus website, and prompt plus palette.
- [ ] Verify blocked internal URLs never cause a server fetch.
- [ ] Verify four distinct directions persist.
- [ ] Verify images complete in positions 1, 2, 3, and 4 with no overlap.
- [ ] Verify refresh recovery and a failed-image retry preserve prior results.
- [ ] Verify recommendation does not automatically select an image.
