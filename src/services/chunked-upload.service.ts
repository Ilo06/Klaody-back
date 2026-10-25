import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '../prisma/client';
import { FILE_ROOT } from '../middleware/upload.middleware';

export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB
export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB, same cap as the multipart path

const UPLOAD_DIR = path.join(FILE_ROOT, '.uploads');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // abandoned sessions are purged after 24 h
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export function partPath(sessionId: string): string {
  return path.join(UPLOAD_DIR, sessionId);
}

/** Creates the sparse part file the chunks are written into. */
export async function createSessionFile(size: number, sessionId: string): Promise<void> {
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  const handle = await fs.promises.open(partPath(sessionId), 'w');
  try {
    await handle.truncate(size);
  } finally {
    await handle.close();
  }
}

/** Generated on-disk name (never the user-supplied name), same shape as the multipart path. */
export function newStoredName(originalName: string): string {
  const ext = path.extname(originalName).slice(0, 16);
  return `${crypto.randomUUID()}${ext}`;
}

/** Removes the part file and the session row (chunk rows cascade). */
export async function discardSession(sessionId: string): Promise<void> {
  await fs.promises.unlink(partPath(sessionId)).catch(() => undefined);
  await prisma.uploadSession.deleteMany({ where: { id: sessionId } });
}

export async function purgeStaleSessions(): Promise<void> {
  const stale = await prisma.uploadSession.findMany({
    where: { createdAt: { lt: new Date(Date.now() - SESSION_TTL_MS) } },
    select: { id: true },
  });
  for (const { id } of stale) {
    await discardSession(id).catch((err) => console.error(`[upload] could not purge session ${id}:`, err));
  }
}

export function startUploadCleanup(): void {
  const run = () => purgeStaleSessions().catch((err) => console.error('[upload] cleanup failed:', err));
  run();
  setInterval(run, CLEANUP_INTERVAL_MS).unref();
}
