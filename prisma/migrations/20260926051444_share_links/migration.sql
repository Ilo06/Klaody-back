-- CreateTable
CREATE TABLE "ShareLink" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "fileId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_fileId_idx" ON "ShareLink"("fileId");

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
