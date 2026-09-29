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
