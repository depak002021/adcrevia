-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'GENERATING', 'IMAGES_READY', 'VIDEO_GENERATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImageStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('IMAGE', 'VIDEO', 'TEXT', 'EMAIL', 'STORAGE');

-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "selectedImageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "original" TEXT NOT NULL,
    "enhanced" TEXT,
    "productJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteReference" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "analysis" JSONB,
    "safeErrorCode" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandPalette" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "colors" JSONB NOT NULL,
    "derived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandPalette_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeDirection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "lighting" TEXT NOT NULL,
    "composition" TEXT NOT NULL,
    "camera" TEXT NOT NULL,
    "mood" TEXT NOT NULL,
    "colorTreatment" TEXT NOT NULL,
    "imagePrompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeDirection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedImage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "ImageStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "model" TEXT,
    "providerAssetId" TEXT,
    "storageKey" TEXT,
    "url" TEXT,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "safeErrorCode" TEXT,
    "technicalLogRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageEvaluation" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "promptAlignment" DOUBLE PRECISION,
    "productConsistency" DOUBLE PRECISION,
    "brandAlignment" DOUBLE PRECISION,
    "composition" DOUBLE PRECISION,
    "visualQuality" DOUBLE PRECISION,
    "commercialSuitability" DOUBLE PRECISION,
    "strengths" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageSelection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedVideo" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceImageId" TEXT NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "model" TEXT,
    "providerTaskId" TEXT,
    "motionStyle" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "storageKey" TEXT,
    "url" TEXT,
    "mimeType" TEXT,
    "checksum" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "safeErrorCode" TEXT,
    "technicalLogRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageGenerationLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "imageId" TEXT,
    "status" "LogStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "durationMs" INTEGER,
    "safeErrorCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageGenerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoGenerationLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "videoId" TEXT,
    "status" "LogStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "providerTaskId" TEXT,
    "durationMs" INTEGER,
    "safeErrorCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoGenerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIProvider" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APIConfiguration" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "endpoint" TEXT,
    "encryptedCredential" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestSucceeded" BOOLEAN,
    "safeTestMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "APIConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_active_idx" ON "User"("role", "active");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expires_idx" ON "Session"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE INDEX "VerificationToken_expires_idx" ON "VerificationToken"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_userId_createdAt_idx" ON "Project"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_status_createdAt_idx" ON "Project"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Project_selectedImageId_idx" ON "Project"("selectedImageId");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_projectId_key" ON "Prompt"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteReference_projectId_key" ON "WebsiteReference"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandPalette_projectId_key" ON "BrandPalette"("projectId");

-- CreateIndex
CREATE INDEX "CreativeDirection_projectId_createdAt_idx" ON "CreativeDirection"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeDirection_projectId_position_key" ON "CreativeDirection"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedImage_directionId_key" ON "GeneratedImage"("directionId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedImage_providerAssetId_key" ON "GeneratedImage"("providerAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedImage_idempotencyKey_key" ON "GeneratedImage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GeneratedImage_projectId_status_idx" ON "GeneratedImage"("projectId", "status");

-- CreateIndex
CREATE INDEX "GeneratedImage_status_createdAt_idx" ON "GeneratedImage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedImage_leaseExpiresAt_idx" ON "GeneratedImage"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedImage_projectId_position_key" ON "GeneratedImage"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ImageEvaluation_imageId_key" ON "ImageEvaluation"("imageId");

-- CreateIndex
CREATE UNIQUE INDEX "ImageSelection_projectId_key" ON "ImageSelection"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ImageSelection_imageId_key" ON "ImageSelection"("imageId");

-- CreateIndex
CREATE INDEX "ImageSelection_selectedAt_idx" ON "ImageSelection"("selectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedVideo_providerTaskId_key" ON "GeneratedVideo"("providerTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedVideo_idempotencyKey_key" ON "GeneratedVideo"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GeneratedVideo_projectId_status_idx" ON "GeneratedVideo"("projectId", "status");

-- CreateIndex
CREATE INDEX "GeneratedVideo_sourceImageId_idx" ON "GeneratedVideo"("sourceImageId");

-- CreateIndex
CREATE INDEX "GeneratedVideo_status_createdAt_idx" ON "GeneratedVideo"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImageGenerationLog_correlationId_key" ON "ImageGenerationLog"("correlationId");

-- CreateIndex
CREATE INDEX "ImageGenerationLog_projectId_createdAt_idx" ON "ImageGenerationLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageGenerationLog_imageId_createdAt_idx" ON "ImageGenerationLog"("imageId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageGenerationLog_status_createdAt_idx" ON "ImageGenerationLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImageGenerationLog_provider_createdAt_idx" ON "ImageGenerationLog"("provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoGenerationLog_correlationId_key" ON "VideoGenerationLog"("correlationId");

-- CreateIndex
CREATE INDEX "VideoGenerationLog_projectId_createdAt_idx" ON "VideoGenerationLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoGenerationLog_videoId_createdAt_idx" ON "VideoGenerationLog"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoGenerationLog_providerTaskId_idx" ON "VideoGenerationLog"("providerTaskId");

-- CreateIndex
CREATE INDEX "VideoGenerationLog_status_createdAt_idx" ON "VideoGenerationLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VideoGenerationLog_provider_createdAt_idx" ON "VideoGenerationLog"("provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIProvider_slug_key" ON "AIProvider"("slug");

-- CreateIndex
CREATE INDEX "AIProvider_kind_enabled_idx" ON "AIProvider"("kind", "enabled");

-- CreateIndex
CREATE INDEX "APIConfiguration_providerId_enabled_idx" ON "APIConfiguration"("providerId", "enabled");

-- CreateIndex
CREATE INDEX "APIConfiguration_createdAt_idx" ON "APIConfiguration"("createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_selectedImageId_fkey" FOREIGN KEY ("selectedImageId") REFERENCES "GeneratedImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteReference" ADD CONSTRAINT "WebsiteReference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandPalette" ADD CONSTRAINT "BrandPalette_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeDirection" ADD CONSTRAINT "CreativeDirection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "CreativeDirection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageEvaluation" ADD CONSTRAINT "ImageEvaluation_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "GeneratedImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageSelection" ADD CONSTRAINT "ImageSelection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageSelection" ADD CONSTRAINT "ImageSelection_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "GeneratedImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedVideo" ADD CONSTRAINT "GeneratedVideo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedVideo" ADD CONSTRAINT "GeneratedVideo_sourceImageId_fkey" FOREIGN KEY ("sourceImageId") REFERENCES "GeneratedImage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageGenerationLog" ADD CONSTRAINT "ImageGenerationLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageGenerationLog" ADD CONSTRAINT "ImageGenerationLog_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "GeneratedImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoGenerationLog" ADD CONSTRAINT "VideoGenerationLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoGenerationLog" ADD CONSTRAINT "VideoGenerationLog_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "GeneratedVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APIConfiguration" ADD CONSTRAINT "APIConfiguration_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AIProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
