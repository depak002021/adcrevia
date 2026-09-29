-- Shape of the campaign frames (9:16 reels, 4:5 feed, 1:1, 16:9, 3:2). Nullable:
-- existing projects keep the original 3:2 landscape behaviour.
ALTER TABLE "Project" ADD COLUMN "imageFormat" TEXT;
