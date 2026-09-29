# Adcrevia Production SaaS Design

## Purpose

Adcrevia is a premium AI creative studio for producing product campaign images and image-led promotional videos. A registered user supplies a product brief, optional website reference, and optional brand palette. Adcrevia derives four creative directions, generates exactly four images sequentially, evaluates them, lets the user select any result, and uses that image as the source for an AI-generated video. Every meaningful state is persisted so work can be resumed safely.

The release also includes a separate Super Admin portal for managing image and video providers, encrypted credentials, users, logs, and system health.

## Delivery Scope

The production release includes:

- Marketing, authentication, password-reset, dashboard, project, generation, video, and settings routes.
- A separate Super Admin login and protected administration routes.
- PostgreSQL persistence through Prisma ORM.
- Real OpenAI-backed prompt analysis, creative-direction generation, image generation, and image evaluation.
- Real Runway image-to-video generation.
- Object storage for generated images and videos.
- Resend-backed password-reset email.
- Provider configuration, encrypted API credentials, connection tests, audit-safe logs, loading states, error recovery, responsive layouts, and accessibility.
- A deployed production instance with database migrations, health checks, and a bootstrapped Super Admin.

The release does not add subscriptions, payment processing, team workspaces, public galleries, collaborative editing, or usage-based billing. The architecture will leave room for those capabilities without implementing them.

## Technical Architecture

Adcrevia will be a modular Next.js App Router application written in TypeScript and deployed as a Cloudflare-compatible Site. The interface will use React, Tailwind CSS, shadcn/ui primitives, Lucide icons, Framer Motion, Sora headings, and Inter body text.

The server-side application will use route handlers, server actions where appropriate, server components by default, and client components only for interactive controls and animation. Browser code communicates only with authenticated Adcrevia endpoints. External provider credentials never cross the server boundary.

Neon PostgreSQL stores application records. Prisma provides the schema, relations, migrations, and typed data access through a Cloudflare-compatible PostgreSQL adapter. Generated files live in object storage; PostgreSQL stores URLs, provider asset identifiers, checksums where useful, dimensions, durations, and other metadata.

The main server modules are:

- Authentication and authorization
- Project and generation orchestration
- Prompt and brand-context analysis
- Website-reference analysis
- Image provider adapters
- Image evaluation
- Video provider adapters
- Storage adapters
- Credential encryption
- Rate limiting and input validation
- Admin reporting and generation logs

Provider interfaces isolate external services from product workflows. The initial active adapters are OpenAI for text/image intelligence, Runway for video generation, and the hosting environment's object storage. New providers can be added without changing project orchestration or user-facing routes.

## User Experience

The visual thesis is a cinematic professional studio: near-black backgrounds, charcoal surfaces, restrained glass effects, off-white text, muted secondary text, and violet-to-electric-blue accents. Motion will be subtle and functional: short page transitions, hover lift, pressed button feedback, progressive result reveals, generation pulses, and success checks. Motion will respect reduced-motion preferences.

The main journey is:

1. Register or sign in.
2. Create a project with a prompt, optional website URL, and optional color palette.
3. Enhance the prompt and inspect available brand context.
4. Generate four structured creative directions.
5. Generate images 01 through 04 sequentially.
6. Evaluate completed images and display an advisory recommendation.
7. Preview and select any image.
8. Configure motion style, duration, aspect ratio, and video instructions.
9. Generate a video from the selected image.
10. Preview and download the result or reopen the project later.

The first dashboard viewport emphasizes starting or continuing creative work, not generic analytics. Desktop and tablet use a two-column or 2-by-2 visual workspace where space permits. Mobile uses a single-column flow, compact navigation, and touch-safe controls.

## Routes and Surfaces

User-facing routes include:

- `/`
- `/features`
- `/pricing`
- `/login`
- `/register`
- `/forgot-password`
- `/reset-password`
- `/dashboard`
- `/dashboard/create`
- `/dashboard/create/video`
- `/dashboard/projects`
- `/dashboard/projects/[projectId]`
- `/dashboard/generations`
- `/dashboard/videos`
- `/dashboard/settings`

Administrative routes include:

- `/admin/login`
- `/admin`
- `/admin/users`
- `/admin/api-providers/images`
- `/admin/api-providers/videos`
- `/admin/logs`
- `/admin/settings`

Route layouts provide separate marketing, authenticated user, and administrative shells. Server-side authorization protects every non-public page and endpoint.

## Authentication and Authorization

Auth.js manages sessions. Email/password registration uses modern password hashing and server-side validation. Password-reset requests create short-lived, single-use tokens stored as hashes and delivered through Resend. Responses do not reveal whether an email address exists.

Roles are `USER` and `SUPER_ADMIN`. Admin routes and endpoints require an authenticated `SUPER_ADMIN` on the server. The admin login route is separate, but separation of routes is not treated as an authorization control. The initial Super Admin is created or promoted through deployment-only bootstrap values and an idempotent seed operation.

Deactivated users cannot start sessions or access protected APIs. Existing sessions are rejected after the account is deactivated.

## Project and Generation Model

A project owns its source prompt, optional website reference, optional palette, creative directions, images, evaluations, selection, videos, and generation logs. Important states are stored in PostgreSQL rather than relying on browser state.

Project states are:

- `DRAFT`
- `GENERATING`
- `IMAGES_READY`
- `VIDEO_GENERATING`
- `COMPLETED`
- `FAILED`

Image states are:

- `PENDING`
- `GENERATING`
- `COMPLETED`
- `FAILED`

Video states are:

- `PENDING`
- `PROCESSING`
- `COMPLETED`
- `FAILED`

Transitions are validated server-side. Each generation record stores attempts, timestamps, provider, model, provider task or asset ID, duration, safe error category, and technical log reference. Idempotency keys prevent accidental duplicate jobs.

## Prompt, Website, and Brand Analysis

Prompt enhancement runs through a protected server endpoint and returns an editable enhanced prompt. Creative-direction generation produces exactly four structured, meaningfully different directions, each containing title, description, environment, lighting, composition, camera direction, mood, color treatment, and image prompt.

Website analysis accepts only valid HTTP or HTTPS URLs. The fetcher blocks localhost, link-local, private, reserved, and otherwise non-public network targets before and after redirects. It enforces redirect, timeout, content-type, response-size, and parsing limits. It extracts only permitted public visual context, such as colors, typography cues, positioning, and overall design language. Access restrictions and analysis failures are shown as non-blocking errors so the user can continue.

The brand palette supports multiple validated hex colors. If no palette is supplied, the analysis service derives a suggested palette from the project context. Derived colors influence the creative workspace without compromising contrast or core product navigation.

## Sequential Image Orchestration

The orchestration service creates four image records in `PENDING` state, then processes one eligible image at a time in ascending concept order. Only one image for a project can be `GENERATING` under normal operation. The transition sequence is persisted transactionally.

The interface polls lightweight project-status endpoints and renders completed images as they arrive. It displays discrete states and indeterminate activity when the provider does not supply measurable progress. It never fabricates a percentage.

A failed image keeps its error category and attempt metadata. The user can retry that image without discarding completed siblings or regenerating creative directions. A server-side lease and recovery timestamp allow abandoned work to be detected and safely resumed.

Product consistency is encouraged by a shared normalized product description, shared brand constraints, prior accepted product references when available, and direction-specific changes limited to environment, lighting, composition, camera, mood, and storytelling. Provider capabilities determine the exact reference-image strategy.

## Image Evaluation and Selection

Evaluation begins after all four image records reach `COMPLETED`. The evaluator considers prompt alignment, product consistency, brand alignment, composition, visual quality, and commercial suitability. Each result stores a score, strengths, and reasoning.

The highest-ranked image receives an `AI Recommended` presentation badge. The recommendation is advisory. The user can select any completed image, change the selection before video generation, and see which image is currently selected. Selection is stored as an explicit relation or unique project-scoped record.

## Video Generation

The video flow requires a completed selected image. It collects motion instructions, style, duration, and aspect ratio, validates them, and creates an asynchronous Runway image-to-video task. Adcrevia stores the provider task ID and exposes safe status data to the browser.

Polling uses bounded backoff and maps provider states into Adcrevia's video state machine. When generation succeeds, the server copies the finished media into controlled object storage and records metadata before marking the video complete. Provider URLs are not treated as permanent application storage.

Failure messages shown to users are friendly and actionable. Technical provider responses remain server-side and are sanitized before logging.

## Provider and Storage Interfaces

The application defines narrow interfaces for image, video, and storage providers. Each adapter owns request mapping, authentication, response normalization, error mapping, timeouts, and provider-specific status handling.

Image and video configurations are independent. Each configuration stores provider name, model, endpoint where applicable, encrypted API key, enabled state, test status, and timestamps. Only one configuration of each provider type is active for new jobs at a time. Existing jobs retain their recorded provider and model metadata.

Connection tests run server-side and return only a pass/fail result plus a safe diagnostic category. They do not expose decrypted keys or raw provider responses.

## Credential Encryption and Secrets

Provider API keys are encrypted before database storage using an authenticated encryption scheme and a server-only master key. Ciphertext includes the nonce and authentication data required for decryption. The master key is supplied through deployment secrets and is never stored in PostgreSQL.

Decrypted provider credentials exist only in server memory for the minimum time required to issue a request. Secrets are excluded from logs, error serialization, analytics, client props, browser storage, and public environment variables. Saved credentials are displayed as a fixed mask rather than a recoverable partial key.

## Data Model

The Prisma schema includes at least:

- `User`
- `Account`
- `Session`
- `VerificationToken`
- `PasswordResetToken`
- `Project`
- `Prompt`
- `WebsiteReference`
- `BrandPalette`
- `CreativeDirection`
- `GeneratedImage`
- `ImageEvaluation`
- `ImageSelection`
- `GeneratedVideo`
- `ImageGenerationLog`
- `VideoGenerationLog`
- `AIProvider`
- `APIConfiguration`
- `SystemSetting`

Relations use foreign keys and appropriate delete behavior. Indexes cover user ID, project ID, provider task ID, status, created time, and common admin-log filters. Unique constraints protect email addresses, provider task IDs where available, and one active image selection per project.

## API Boundaries

Primary API groups are:

- Authentication and password reset
- Prompt enhancement
- Website analysis
- Creative-direction generation
- Project creation, retrieval, update, rename, and deletion
- Image generation, status, retry, evaluation, download, and selection
- Video generation, status, and download
- Admin dashboard, users, logs, providers, connection tests, and settings
- Provider webhooks when supported

Every endpoint performs server-side authentication, authorization, validation, and ownership checks. Webhooks validate provider authenticity when supported and use idempotent event handling.

## Security Controls

The application uses Zod validation, secure session cookies, CSRF protection where applicable, rate limits, request-size limits, safe URL handling, upload and content-type validation, secure headers, and generic public error messages. Destructive actions use confirmation dialogs and server-side ownership checks.

Website analysis includes SSRF defenses. Redirect destinations are revalidated. Internal network addresses, metadata endpoints, non-HTTP schemes, and oversized responses are rejected.

Normal logs never contain passwords, password-reset tokens, session tokens, authorization headers, API keys, encryption keys, or full sensitive request bodies.

## Error Handling and Recovery

Errors are grouped into validation, authentication, authorization, rate-limit, timeout, network, provider-unavailable, provider-rejected, storage, and internal categories. Users receive concise recovery guidance. Administrators receive safe operational context and a correlation ID, while detailed diagnostics remain server-side.

All asynchronous UI actions have visible loading, disabled, success, empty, and failure states. Partial project progress is retained. Retriable jobs reuse existing project records and do not silently duplicate billable work.

## Accessibility and Responsive Behavior

The application uses semantic landmarks, labeled controls, keyboard-accessible navigation, visible focus states, accessible dialogs, sufficient color contrast, and reduced-motion support. Status is communicated through text and icons rather than color alone. Generated media includes descriptive project-level labels where user-provided alt text is unavailable.

Desktop and tablet show a 2-by-2 image grid. Mobile shows a single-column list. Navigation becomes an accessible drawer on smaller screens. Dialogs, media controls, forms, and action menus remain usable with keyboard, touch, and 200% text enlargement.

## Verification Strategy

Automated coverage focuses on high-risk behavior:

- Authentication, session protection, password reset, and deactivation
- User and Super Admin authorization boundaries
- Encryption round trips and masked credential responses
- URL validation and SSRF prevention
- Generation state-machine transitions and idempotency
- Strict sequential image ordering
- Retry behavior after partial failure
- Evaluation and user-selection override
- Video task creation, polling, completion, and storage transfer
- Project ownership and persistence
- Provider error normalization and secret redaction

Integration tests use controlled provider doubles. Production smoke testing uses the configured real providers and verifies one complete prompt-to-video project. Responsive and accessibility checks cover representative marketing, workspace, modal, and admin routes.

## Deployment

Deployment uses separate development and production secrets. Production setup requires a PostgreSQL connection, Auth.js secret, encryption key, object-storage bindings, OpenAI credential, Runway credential, Resend credential, trusted application origin, and initial Super Admin bootstrap values.

Database migrations run before the production release. The deployment exposes a health endpoint that checks application availability without leaking configuration. Provider connectivity is reported separately so a temporary external outage does not misrepresent core application health.

The release is complete only when the deployed instance passes registration, login, authorization, prompt analysis, website analysis, palette handling, four-image sequential generation, evaluation, manual selection override, image-to-video generation, media persistence, project recovery, provider administration, responsive behavior, and client-secret exposure checks.

## Acceptance Criteria

- A new user can register, sign in, create a project, and resume it after refresh.
- Website analysis failures do not prevent generation.
- Exactly four creative directions and four image records are created per standard generation run.
- Images generate one at a time and completed results remain visible during later steps.
- No fabricated progress percentage is displayed.
- The evaluator recommends an image, but the user can select another.
- Only the selected completed image can start video generation.
- The completed video is stored under application control and can be previewed and downloaded.
- User and administrator authorization is enforced on pages and APIs.
- Provider keys remain encrypted at rest, masked in the interface, absent from logs, and absent from browser-delivered code and data.
- Projects, images, selections, videos, and generation logs persist in PostgreSQL.
- The application is usable on desktop, tablet, and mobile and supports keyboard navigation.
- The production deployment uses real configured providers and contains no fake production responses.
