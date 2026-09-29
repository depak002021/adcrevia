# Variable Image Counts and FLUX Multi-Scene Video Design

**Date:** 2026-09-17

## Objective

Give Super Admins control over the default number of generated campaign images, let users select and order multiple completed images, and generate one multi-scene video from those images through Black Forest Labs FLUX 3. Add encrypted Black Forest Labs provider configuration for FLUX.2 image generation and FLUX 3 video generation while preserving OpenAI and Runway as supported alternatives.

## Product Decisions

- The Super Admin chooses a default image count from 1 through 10. The initial value is 4.
- Every project snapshots the current default when it is created. Later system-setting changes affect new projects only.
- A project generates one creative direction and one image for every position from 1 through its snapshot count.
- Image generation remains strictly sequential within a project.
- A user may select 1 through 10 completed project images and explicitly order them.
- A FLUX 3 render uses the ordered images as timed keyframes and produces one continuous multi-scene video.
- Runway remains available for a single selected image. Multiple selected images require FLUX 3 as the active video provider.
- Existing projects retain their current practical behavior: their target count is backfilled from their existing direction or image count, falling back to 4.
- Existing single selections migrate to position 1 without loss.

## Administrative Experience

### Generation Policy

`/admin/settings` becomes an editable policy page. Its generation section contains a numeric control named **Default images per project**, constrained to 1–10. Saving requires Super Admin authorization and validates the value server-side. The page explains that changes apply only to newly created projects.

The value is stored in `SystemSetting` under `generation.defaultImageCount`. Reads use 4 when the setting is absent or invalid. The settings API returns only safe operational values.

### FLUX Provider Configuration

A new `/admin/api-providers/flux` page contains one Black Forest Labs form with:

- BFL API key
- Image model, default `flux-2-pro`
- Video model, default `flux-3-video`
- Enable for image generation
- Enable for video generation
- Test connection

The form writes two independent encrypted configurations internally: `bfl-image` and `bfl-video`. This avoids the current one-kind-per-provider collision and allows FLUX to be active for images, videos, both, or neither. The API key is submitted once and encrypted separately for both configurations; the independent enable flags govern whether each configuration can be used. Responses expose a fixed mask only.

Connection testing calls the BFL credits endpoint with the supplied key and returns only `CONNECTED`, `AUTHENTICATION_FAILED`, `RATE_LIMITED`, or `PROVIDER_UNAVAILABLE`. No balance, key fragment, provider response body, or authorization header is stored or returned.

OpenAI and Runway configuration pages remain available. Image and video activation remain independent. OpenAI text intelligence uses the latest valid saved OpenAI credential even when FLUX is the active image provider.

## Project Image Count

Add `targetImageCount Int @default(4)` to `Project`. Project creation reads the current generation policy and persists the snapshot in the same create operation.

The text-intelligence interface changes from `createDirections(context)` to `createDirections(context, count)`. Its structured-output schema is built for the requested count and validates exactly that many distinct directions. The prompt names the exact count rather than hard-coding four.

Image-run creation accepts ordered directions only when their positions exactly equal `1..targetImageCount`. The workspace renders that many progress steps and placeholders, and the client loop processes at most that many sequential jobs. Completion and evaluation compare against the project snapshot rather than a global setting.

Limits are enforced in every layer:

- Admin input: integer 1–10
- Stored project snapshot: integer 1–10
- Direction response: exact snapshot count
- Generated-image positions: unique and contiguous for the project
- Evaluation response: exactly one evaluation for every completed project image

## Image Providers

The existing `ImageProvider` interface remains the orchestration boundary.

### OpenAI

The current OpenAI adapter remains unchanged except that runtime configuration resolves the active image provider before construction.

### FLUX.2

Add a BFL adapter that submits `POST /v1/flux-2-pro`, stores the returned task identifier and polling URL in memory for the request, polls the documented result endpoint with bounded exponential backoff, downloads the completed image bytes, and returns them through the existing `ImageGenerationResult` interface.

Provider polling has an explicit deadline and maps authentication, credit/rate-limit, moderation, timeout, and upstream failures to safe internal categories. Raw provider bodies and credentials are never persisted. Generated bytes continue through the existing storage provider, checksum, and project state transitions.

## Multi-Image Selection

Replace the one-row-per-project `ImageSelection` contract with ordered selections:

- `id`
- `projectId`
- `imageId`
- `position`
- `selectedAt`
- unique `(projectId, imageId)`
- unique `(projectId, position)`

The migration adds `position`, removes the unique constraints on `projectId` and `imageId`, creates the composite constraints, and assigns all existing selections position 1. `Project.selectedImageId` remains temporarily as a compatibility pointer to the first selected image; new code treats ordered `ImageSelection` rows as authoritative.

Selection is replaced atomically through `PUT /api/projects/:projectId/image-selection` with an ordered array of image IDs. The service verifies:

- the project belongs to the current user;
- every ID belongs to that project;
- every image is completed and has a stored URL;
- IDs are unique;
- the selection contains 1–10 images.

The project workspace changes image cards from a single **Use for video** action to selection toggles. Selected cards show order badges. An ordered selection tray supports moving images left or right and removing them. Saving persists the entire order atomically. The video CTA appears when at least one selection is saved.

## FLUX 3 Multi-Scene Video

The video input and provider boundary accept `sourceImages: Array<{ id: string; url: string; position: number }>` rather than one source image.

For FLUX 3:

- Mode is `i2v`.
- One selected image is sent as a single opening keyframe.
- Multiple images are sent as `[timestamp, image]` keyframes.
- Timestamps are distributed from 0 through the selected duration while preserving user order.
- Duration supports 5–20 whole seconds and must provide enough spacing for the selected count. The UI raises the minimum automatically when necessary.
- The prompt identifies shots in order and requests intentional transitions or hard cuts while maintaining product identity.
- The request returns a task ID and polling URL. The polling URL is stored as provider task metadata, never exposed to other users, and polled until `Ready` or a terminal safe failure.
- The final signed MP4 is copied into the configured storage provider before the video is marked completed.

FLUX 3 returns one finished video, so no server-side FFmpeg stitching process is required. This is compatible with Vercel’s execution model and local development.

For Runway, one selected image continues through the existing adapter. If more than one image is selected while Runway is active, the API returns `MULTI_IMAGE_REQUIRES_FLUX` and the UI offers a direct link to the Super Admin FLUX configuration page for administrators or a neutral provider-unavailable message for normal users.

## Video Persistence

Keep `GeneratedVideo.sourceImageId` as the first-frame compatibility field. Add `GeneratedVideoSource`:

- `id`
- `videoId`
- `imageId`
- `position`
- unique `(videoId, imageId)`
- unique `(videoId, position)`

Video creation writes the video row and all ordered source rows in one transaction. The idempotency hash includes the ordered image IDs, prompt, motion style, duration, aspect ratio, and active provider/model. Reordering the same images therefore creates a distinct intentional render.

## Provider Resolution

Runtime provider resolution becomes explicit:

- Active image configuration resolves to OpenAI or BFL.
- Active video configuration resolves to Runway or BFL.
- Text intelligence resolves the latest decryptable OpenAI credential independently of active image selection.
- Environment variables remain server-only fallback configuration.
- A partially configured database provider never silently falls back to another provider.

Provider slugs include kind (`openai-image`, `runway-video`, `bfl-image`, `bfl-video`) so saving one kind cannot mutate another kind’s identity.

## Error Handling

User-facing failures remain safe and actionable:

- invalid policy value → `400` with a field-safe message;
- provider key rejected → connection-test category only;
- insufficient BFL credits or rate limit → safe provider-capacity message;
- moderated generation → safe content-policy message;
- provider timeout → generation remains retryable;
- non-contiguous directions → generation does not start;
- invalid or cross-project selection → `404` without ownership disclosure;
- Runway with multiple sources → `422 MULTI_IMAGE_REQUIRES_FLUX`;
- failed video task → selected images and project remain unchanged.

Technical logs may contain provider name, model, task ID, duration, correlation ID, and safe error code. They must not contain API keys, polling authorization, raw request headers, base64 media, or provider response bodies.

## Migration and Compatibility

The migration is additive wherever practical:

1. Add `Project.targetImageCount` with default 4.
2. Backfill it from the maximum of existing direction/image counts constrained to 1–10, otherwise 4.
3. Add `ImageSelection.position` with default 1.
4. Replace single-selection unique indexes with ordered composite indexes.
5. Add `GeneratedVideoSource` and backfill one position-1 row from each existing `GeneratedVideo.sourceImageId`.
6. Preserve `Project.selectedImageId` and `GeneratedVideo.sourceImageId` as compatibility pointers.

No generated media or existing project is deleted.

## Testing and Acceptance

Unit and integration coverage must prove:

- generation policy accepts 1 and 10 and rejects values outside the range;
- new projects snapshot the current policy;
- changing policy does not modify existing projects;
- dynamic structured output accepts exactly the project count;
- sequential orchestration supports counts other than four;
- ordered selection rejects duplicates, foreign images, failed images, and more than ten images;
- reordering persists deterministic positions;
- FLUX.2 submit/poll/result normalization works with safe failures;
- FLUX 3 receives ordered timestamped keyframes and returns one task;
- Runway rejects multiple sources before provider submission;
- idempotency changes when source order changes;
- existing single selections and videos survive migration;
- provider credentials remain encrypted, masked, and absent from client bundles.

End-to-end acceptance covers an administrator setting a count other than four, a user creating a project with that many directions and images, selecting several in a chosen order, and receiving one stored FLUX 3 video whose source records preserve that order.

## Out of Scope

- Joining multiple Runway clips with FFmpeg or a separate rendering service
- Per-user generation-count overrides
- Changing the image count after a project has been created
- More than ten selected images or FLUX keyframes
- Automatic provider fallback after a paid generation request has started
