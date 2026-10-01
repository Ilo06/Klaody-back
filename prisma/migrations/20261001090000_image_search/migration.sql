-- Semantic image search: CLIP embeddings stored with pgvector.
-- Requires the `vector` extension (Supabase and Neon provide it; on a self-hosted Postgres install pgvector first).

CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "IndexStatus" AS ENUM ('NONE', 'PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "File" ADD COLUMN "indexStatus" "IndexStatus" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "ImageEmbedding" (
    "fileId" UUID NOT NULL,
    "embedding" vector(512) NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageEmbedding_pkey" PRIMARY KEY ("fileId")
);

-- AddForeignKey (embeddings disappear with the file, including when the trash is emptied)
ALTER TABLE "ImageEmbedding" ADD CONSTRAINT "ImageEmbedding_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
