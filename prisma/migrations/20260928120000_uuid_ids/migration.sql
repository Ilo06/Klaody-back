-- Convert every integer primary/foreign key (SERIAL) to a native Postgres UUID, keeping existing data.
-- Requires PostgreSQL 13+ (gen_random_uuid() is built in). Take a backup before applying.

-- 1) Add the new uuid columns (existing rows each get their own random uuid).
ALTER TABLE "User"      ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "Folder"    ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid(),
                        ADD COLUMN "new_parentId" UUID,
                        ADD COLUMN "new_userId" UUID;
ALTER TABLE "File"      ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid(),
                        ADD COLUMN "new_folderId" UUID,
                        ADD COLUMN "new_userId" UUID;
ALTER TABLE "ShareLink" ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid(),
                        ADD COLUMN "new_fileId" UUID;

-- 2) Re-point every relation to the new ids.
UPDATE "Folder"    f SET "new_userId"   = u."new_id" FROM "User"   u WHERE f."userId"   = u."id";
UPDATE "Folder"    f SET "new_parentId" = p."new_id" FROM "Folder" p WHERE f."parentId" = p."id";
UPDATE "File"      f SET "new_userId"   = u."new_id" FROM "User"   u WHERE f."userId"   = u."id";
UPDATE "File"      f SET "new_folderId" = d."new_id" FROM "Folder" d WHERE f."folderId" = d."id";
UPDATE "ShareLink" s SET "new_fileId"   = f."new_id" FROM "File"   f WHERE s."fileId"   = f."id";

-- 3) Drop the old foreign keys.
ALTER TABLE "File"      DROP CONSTRAINT "File_userId_fkey";
ALTER TABLE "File"      DROP CONSTRAINT "File_folderId_fkey";
ALTER TABLE "Folder"    DROP CONSTRAINT "Folder_userId_fkey";
ALTER TABLE "Folder"    DROP CONSTRAINT "Folder_parentId_fkey";
ALTER TABLE "ShareLink" DROP CONSTRAINT "ShareLink_fileId_fkey";

-- 4) Drop the old integer columns (this also drops their primary keys and indexes) and the sequences.
ALTER TABLE "ShareLink" DROP COLUMN "id", DROP COLUMN "fileId";
ALTER TABLE "File"      DROP COLUMN "id", DROP COLUMN "folderId", DROP COLUMN "userId";
ALTER TABLE "Folder"    DROP COLUMN "id", DROP COLUMN "parentId", DROP COLUMN "userId";
ALTER TABLE "User"      DROP COLUMN "id";

-- 5) Rename the new columns to their final names.
ALTER TABLE "User"      RENAME COLUMN "new_id"       TO "id";
ALTER TABLE "Folder"    RENAME COLUMN "new_id"       TO "id";
ALTER TABLE "Folder"    RENAME COLUMN "new_parentId" TO "parentId";
ALTER TABLE "Folder"    RENAME COLUMN "new_userId"   TO "userId";
ALTER TABLE "File"      RENAME COLUMN "new_id"       TO "id";
ALTER TABLE "File"      RENAME COLUMN "new_folderId" TO "folderId";
ALTER TABLE "File"      RENAME COLUMN "new_userId"   TO "userId";
ALTER TABLE "ShareLink" RENAME COLUMN "new_id"       TO "id";
ALTER TABLE "ShareLink" RENAME COLUMN "new_fileId"   TO "fileId";

-- 6) Restore constraints (NOT NULL, primary keys, indexes, foreign keys).
ALTER TABLE "Folder"    ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "File"      ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ShareLink" ALTER COLUMN "fileId" SET NOT NULL;

ALTER TABLE "User"      ADD CONSTRAINT "User_pkey"      PRIMARY KEY ("id");
ALTER TABLE "Folder"    ADD CONSTRAINT "Folder_pkey"    PRIMARY KEY ("id");
ALTER TABLE "File"      ADD CONSTRAINT "File_pkey"      PRIMARY KEY ("id");
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id");

CREATE INDEX "Folder_userId_parentId_idx" ON "Folder"("userId", "parentId");
CREATE INDEX "File_userId_idx"            ON "File"("userId");
CREATE INDEX "File_folderId_idx"          ON "File"("folderId");
CREATE INDEX "ShareLink_fileId_idx"       ON "ShareLink"("fileId");

ALTER TABLE "Folder"    ADD CONSTRAINT "Folder_userId_fkey"   FOREIGN KEY ("userId")   REFERENCES "User"("id")   ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Folder"    ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "File"      ADD CONSTRAINT "File_userId_fkey"     FOREIGN KEY ("userId")   REFERENCES "User"("id")   ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "File"      ADD CONSTRAINT "File_folderId_fkey"   FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_fileId_fkey" FOREIGN KEY ("fileId")  REFERENCES "File"("id")   ON DELETE CASCADE  ON UPDATE CASCADE;
