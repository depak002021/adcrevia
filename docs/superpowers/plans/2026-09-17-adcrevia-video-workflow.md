# Adcrevia Video Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, track, store, preview, and download a real promotional video from the user's selected completed image.

**Architecture:** A provider-neutral video service creates an asynchronous Runway task, stores its task ID, polls with bounded backoff, and copies completed output into controlled storage. Persisted state allows refresh recovery and safe retries.

**Tech Stack:** Next.js, TypeScript, Prisma, Runway SDK, object storage, Zod, Vitest, Playwright, Framer Motion.

**Spec:** `docs/superpowers/specs/2026-09-17-adcrevia-design.md`

## Global Constraints

- Require an explicitly selected completed image.
- Send the selected image as the video provider's source/reference image.
- Persist provider task ID and every video status transition.
- Use provider progress only when the provider supplies it; otherwise show indeterminate activity.
- Copy completed media into application-controlled object storage.
- Do not expose Runway credentials or raw provider responses.

---

### Task 1: Video Provider Contract and Runway Adapter

**Files:**
- Create: `src/lib/providers/videos/types.ts`
- Create: `src/lib/providers/videos/runway.ts`
- Create: `src/lib/providers/videos/errors.ts`
- Test: `src/lib/providers/videos/runway.test.ts`

**Interfaces:**
- Produces: `VideoProvider.create(input)`, `VideoProvider.getStatus(taskId)`, normalized task states.
- Consumes: decrypted active video configuration and HTTPS source-image URL.

- [ ] **Step 1: Write failing request-mapping and error-redaction tests**

```ts
it("maps a selected image into a Runway image-to-video task", async () => {
  await provider.create({ sourceImageUrl, prompt: "Slow orbit", duration: 5, aspectRatio: "16:9" })
  expect(runway.imageToVideo.create).toHaveBeenCalledWith(expect.objectContaining({
    promptImage: sourceImageUrl,
    promptText: "Slow orbit",
    duration: 5,
    ratio: "1280:720",
  }))
})
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run src/lib/providers/videos/runway.test.ts`

Expected: FAIL because the provider contract and adapter are missing.

- [ ] **Step 3: Define normalized video contracts**

```ts
export type VideoTaskState = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED"
export interface VideoProvider {
  create(input: VideoGenerationInput): Promise<{ taskId: string }>
  getStatus(taskId: string): Promise<{ state: VideoTaskState; progress?: number; outputUrl?: string; errorCode?: string }>
}
```

- [ ] **Step 4: Implement Runway adapter with model and ratio mapping**

```ts
const task = await client.imageToVideo.create({
  model: configuration.model,
  promptImage: input.sourceImageUrl,
  promptText: input.prompt,
  duration: input.duration,
  ratio: ratioMap[input.aspectRatio],
})
return { taskId: task.id }
```

Map SDK/provider failures into stable internal codes and exclude authorization data, request headers, and raw provider bodies.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run src/lib/providers/videos/runway.test.ts`

Expected: PASS for request mapping, supported durations/ratios, state normalization, and secret redaction.

```bash
git add src/lib/providers/videos
git commit -m "feat: add Runway video provider adapter"
```

### Task 2: Persisted Video State Machine and Polling

**Files:**
- Create: `src/features/videos/schemas.ts`
- Create: `src/features/videos/state-machine.ts`
- Create: `src/features/videos/service.ts`
- Create: `src/app/api/videos/generate/route.ts`
- Create: `src/app/api/videos/[videoId]/route.ts`
- Create: `src/app/api/videos/[videoId]/refresh/route.ts`
- Test: `src/features/videos/service.test.ts`

**Interfaces:**
- Produces: `startVideoGeneration(input, userId)`, `refreshVideoStatus(videoId, userId)`, `getOwnedVideo(videoId, userId)`.
- Consumes: selected completed image, `VideoProvider`, `StorageProvider`.

- [ ] **Step 1: Write failing state and ownership tests**

```ts
it("rejects generation when the project has no selected image", async () => {
  await expect(startVideoGeneration(validInput, user.id)).rejects.toMatchObject({ code: "SELECTED_IMAGE_REQUIRED" })
})

it("stores provider output before marking a video completed", async () => {
  videoProvider.getStatus.mockResolvedValue({ state: "SUCCEEDED", outputUrl: providerUrl })
  await refreshVideoStatus(video.id, user.id)
  expect(storage.copyRemote).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: providerUrl }))
  expect((await loadVideo(video.id)).status).toBe("COMPLETED")
})
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run src/features/videos/service.test.ts`

Expected: FAIL because service and state machine are missing.

- [ ] **Step 3: Implement validated input and legal transitions**

```ts
export const videoInputSchema = z.object({
  projectId: z.string().cuid(),
  prompt: z.string().trim().min(8).max(2000),
  motionStyle: z.enum(["CINEMATIC", "PRODUCT_COMMERCIAL", "LUXURY", "DYNAMIC", "MINIMAL", "CUSTOM"]),
  duration: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5"]),
})
```

Permit `PENDING -> PROCESSING -> COMPLETED|FAILED` and `FAILED -> PENDING`. Use idempotency keys so repeated submission does not create duplicate billable tasks.

- [ ] **Step 4: Implement task creation, status refresh, and storage transfer**

```ts
export async function refreshVideoStatus(videoId: string, userId: string) {
  const video = await requireOwnedVideo(videoId, userId)
  const status = await providerFor(video).getStatus(video.providerTaskId!)
  if (status.state === "SUCCEEDED" && status.outputUrl) {
    const stored = await storage.copyRemote({ sourceUrl: status.outputUrl, key: videoStorageKey(video) })
    return completeVideo(video.id, stored)
  }
  return persistNormalizedStatus(video.id, status)
}
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run src/features/videos/service.test.ts`

Expected: PASS for selection requirement, ownership, idempotency, task state mapping, storage-before-completion, and retry.

```bash
git add src/features/videos src/app/api/videos
git commit -m "feat: persist asynchronous video generation"
```

### Task 3: Video Creation Experience and Result Playback

**Files:**
- Create: `src/app/dashboard/create/video/page.tsx`
- Create: `src/app/dashboard/videos/page.tsx`
- Create: `src/components/videos/video-generator.tsx`
- Create: `src/components/videos/video-progress.tsx`
- Create: `src/components/videos/video-player.tsx`
- Test: `e2e/video-workflow.spec.ts`

**Interfaces:**
- Produces: video configuration form, truthful generation timeline, result player, controlled download action.
- Consumes: selected image, generation/status endpoints, stored video metadata.

- [ ] **Step 1: Write the failing browser journey**

```ts
test("selected image becomes a stored playable video", async ({ page }) => {
  await openSeededSelectedProject(page)
  await page.getByRole("button", { name: "Use for Video" }).click()
  await page.getByLabel("Video prompt").fill("Slow cinematic orbit with soft reflections")
  await page.getByRole("button", { name: "Generate Video" }).click()
  await expect(page.getByText("Creating motion")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Your video is ready" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Download Video" })).toBeEnabled()
})
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm playwright test e2e/video-workflow.spec.ts`

Expected: FAIL because the video pages and components are missing.

- [ ] **Step 3: Implement the accessible configuration form and source preview**

```tsx
<VideoGenerator
  sourceImage={selection.image}
  durations={[5, 10, 15]}
  aspectRatios={["16:9", "9:16", "1:1", "4:5"]}
  motionStyles={["CINEMATIC", "PRODUCT_COMMERCIAL", "LUXURY", "DYNAMIC", "MINIMAL", "CUSTOM"]}
/>
```

- [ ] **Step 4: Implement bounded polling, timeline, player, and download**

```tsx
<VideoProgress
  steps={["Preparing source image", "Preparing creative instructions", "Creating motion", "Rendering", "Finalizing"]}
  status={video.status}
  providerProgress={video.providerProgress ?? undefined}
/>
```

Only render a numeric progress bar when `providerProgress` exists. Stop polling on terminal status, visibility loss, or component unmount. Use the native video element with labeled play, pause, volume, and fullscreen controls.

- [ ] **Step 5: Run browser test, accessibility scan, build, and commit**

Run: `pnpm playwright test e2e/video-workflow.spec.ts && pnpm build`

Expected: PASS for selected-source display, generation recovery after refresh, result playback, download, create-another, and back-to-images actions.

```bash
git add src/app/dashboard/create/video src/app/dashboard/videos src/components/videos e2e/video-workflow.spec.ts
git commit -m "feat: complete Adcrevia video creation experience"
```

## Video Workflow Exit Gate

- [ ] Verify no video can start without an owned completed selected image.
- [ ] Verify Runway receives the selected image URL and validated options.
- [ ] Verify task status survives refresh and duplicate submits remain idempotent.
- [ ] Verify completed provider media is copied into controlled storage.
- [ ] Verify the player and download work on desktop and mobile.

