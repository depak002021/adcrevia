-- Durable job queue, agentic brief, video composition, versioned prompts and waitlist.
--
-- Assembled from Prisma's own DDL output (see scripts/extract-migration.mjs) and
-- extended with two things Prisma cannot express in the schema language:
--   * the additive ALTERs for ImageEvaluation.recommended and
--     APIConfiguration.settings, which are new columns on existing tables
--   * a PARTIAL unique index guaranteeing at most one active PromptTemplate per
--     key, which is the invariant that makes rollback safe
--
-- Every statement is additive. No existing column is dropped or retyped, so this
-- applies to a populated database without data loss.


-- Enums

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('IMAGE_GENERATE', 'IMAGE_EVALUATE', 'VIDEO_SUBMIT', 'VIDEO_POLL', 'VIDEO_COMPOSE', 'VIDEO_EXPORT', 'WEBSITE_SCRAPE', 'AGENT_STEP');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "ConversationPhase" AS ENUM ('DISCOVERY', 'PRODUCT_CONFIRM', 'DIRECTION', 'READY');

-- CreateEnum
CREATE TYPE "DecisionKind" AS ENUM ('NOUL', 'CHOICE', 'SCORE');

-- CreateEnum
CREATE TYPE "CompositionStatus" AS ENUM ('DRAFT', 'QUEUED', 'RENDERING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ClipTransition" AS ENUM ('NONE', 'CROSSFADE', 'FADE_BLACK', 'DISSOLVE', 'WIPE_LEFT', 'WIPE_RIGHT');

-- CreateEnum
CREATE TYPE "AudioTrackKind" AS ENUM ('MUSIC', 'VOICEOVER');

-- New tables

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT,
    "payload" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressLabel" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "safeErrorCode" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phase" "ConversationPhase" NOT NULL DEFAULT 'DISCOVERY',
    "completeness" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolName" TEXT,
    "toolResult" JSONB,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "model" TEXT,
    "promptTemplateId" TEXT,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "latencyMs" INTEGER,
    "safeErrorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "kind" "DecisionKind" NOT NULL,
    "instructions" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoComposition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "CompositionStatus" NOT NULL DEFAULT 'DRAFT',
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "width" INTEGER NOT NULL DEFAULT 1080,
    "height" INTEGER NOT NULL DEFAULT 1920,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "loudnessTarget" DOUBLE PRECISION NOT NULL DEFAULT -14,
    "durationMs" INTEGER,
    "storageKey" TEXT,
    "url" TEXT,
    "posterKey" TEXT,
    "posterUrl" TEXT,
    "checksum" TEXT,
    "safeErrorCode" TEXT,
    "renderedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoComposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositionClip" (
    "id" TEXT NOT NULL,
    "compositionId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "trimInMs" INTEGER NOT NULL DEFAULT 0,
    "trimOutMs" INTEGER,
    "transition" "ClipTransition" NOT NULL DEFAULT 'CROSSFADE',
    "transitionMs" INTEGER NOT NULL DEFAULT 500,
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompositionClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositionRender" (
    "id" TEXT NOT NULL,
    "compositionId" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "status" "CompositionStatus" NOT NULL DEFAULT 'QUEUED',
    "storageKey" TEXT,
    "url" TEXT,
    "posterKey" TEXT,
    "posterUrl" TEXT,
    "bytes" INTEGER,
    "durationMs" INTEGER,
    "safeErrorCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositionRender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioTrack" (
    "id" TEXT NOT NULL,
    "compositionId" TEXT NOT NULL,
    "kind" "AudioTrackKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "gainDb" DOUBLE PRECISION NOT NULL DEFAULT -18,
    "duck" BOOLEAN NOT NULL DEFAULT true,
    "startMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "model" TEXT,
    "temperature" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistSignup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sells" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "website" TEXT,
    "source" TEXT,
    "confirmationSentAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistSignup_pkey" PRIMARY KEY ("id")
);

-- Indexes

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_priority_idx" ON "Job"("status", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "Job_projectId_createdAt_idx" ON "Job"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_leaseExpiresAt_idx" ON "Job"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "Job_kind_status_idx" ON "Job"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_projectId_key" ON "Conversation"("projectId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_position_key" ON "Message"("conversationId", "position");

-- CreateIndex
CREATE INDEX "AgentRun_conversationId_createdAt_idx" ON "AgentRun"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Decision_projectId_key_createdAt_idx" ON "Decision"("projectId", "key", "createdAt");

-- CreateIndex
CREATE INDEX "Decision_agentRunId_idx" ON "Decision"("agentRunId");

-- CreateIndex
CREATE INDEX "Decision_key_createdAt_idx" ON "Decision"("key", "createdAt");

-- CreateIndex
CREATE INDEX "VideoComposition_projectId_createdAt_idx" ON "VideoComposition"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoComposition_status_createdAt_idx" ON "VideoComposition"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CompositionClip_videoId_idx" ON "CompositionClip"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "CompositionClip_compositionId_position_key" ON "CompositionClip"("compositionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CompositionClip_compositionId_videoId_key" ON "CompositionClip"("compositionId", "videoId");

-- CreateIndex
CREATE INDEX "CompositionRender_status_createdAt_idx" ON "CompositionRender"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompositionRender_compositionId_preset_key" ON "CompositionRender"("compositionId", "preset");

-- CreateIndex
CREATE INDEX "AudioTrack_compositionId_idx" ON "AudioTrack"("compositionId");

-- CreateIndex
CREATE INDEX "PromptTemplate_key_active_idx" ON "PromptTemplate"("key", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_key_version_key" ON "PromptTemplate"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistSignup_email_key" ON "WaitlistSignup"("email");

-- CreateIndex
CREATE INDEX "WaitlistSignup_createdAt_idx" ON "WaitlistSignup"("createdAt");

-- CreateIndex
CREATE INDEX "WaitlistSignup_businessType_idx" ON "WaitlistSignup"("businessType");

-- CreateIndex
CREATE INDEX "WaitlistSignup_invitedAt_idx" ON "WaitlistSignup"("invitedAt");

-- Foreign keys

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_promptTemplateId_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "PromptTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoComposition" ADD CONSTRAINT "VideoComposition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionClip" ADD CONSTRAINT "CompositionClip_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "VideoComposition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionClip" ADD CONSTRAINT "CompositionClip_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "GeneratedVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionRender" ADD CONSTRAINT "CompositionRender_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "VideoComposition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "VideoComposition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Additive columns on existing tables.
-- ImageEvaluation.recommended was previously computed in memory on every request
-- and recomputed again client-side, so nothing recorded which frame had actually
-- been recommended.
ALTER TABLE "ImageEvaluation" ADD COLUMN "recommended" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "ImageEvaluation_recommended_idx" ON "ImageEvaluation"("recommended");

-- Non-secret provider configuration that still belongs beside the credential,
-- readable in the admin console without decryption.
ALTER TABLE "APIConfiguration" ADD COLUMN "settings" JSONB;

-- At most one active version per prompt key. Prisma's schema language has no
-- partial unique index, so activating a version has to be safe at the database
-- level rather than relying on application code to deactivate the previous one
-- first.
CREATE UNIQUE INDEX "PromptTemplate_key_active_unique"
  ON "PromptTemplate"("key")
  WHERE "active";
