import fs from 'fs/promises';
import path from 'path';
import PgBoss from 'pg-boss';
import prisma from '../prisma/client';
import { FILE_ROOT } from '../middleware/upload.middleware';
import { CLIP_MODEL_ID, embedImage, toVectorLiteral, warmUpClip } from './clip.service';

// Background image indexing: upload -> job in a Postgres-backed queue (pg-boss) -> CLIP embedding -> pgvector.
// pg-boss keeps its own tables in a separate `pgboss` schema of the same database, so no Redis is needed.

const QUEUE = 'index-image';

// Formats sharp (used by transformers.js) can decode reliably. SVG/HEIC/RAW are not indexed.
const INDEXABLE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff']);
const MAX_INDEX_BYTES = Number(process.env.INDEX_MAX_BYTES) || 50 * 1024 * 1024;

type IndexJob = { fileId: string };

let boss: PgBoss | null = null;

export function isIndexable(mimeType: string, size: number | bigint): boolean {
  return INDEXABLE_MIME.has(mimeType.toLowerCase()) && Number(size) <= MAX_INDEX_BYTES;
}

/** Starts the queue and the worker (one job at a time: CLIP inference is CPU-bound). */
export async function startIndexing(): Promise<void> {
  const connectionString = process.env.PGBOSS_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  boss = new PgBoss({ connectionString, max: 3 });
  boss.on('error', (err) => console.error('[indexing] pg-boss error:', err));
  await boss.start();

  await boss.createQueue(QUEUE, {
    name: QUEUE,
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 15 * 60,
  });

  await boss.work<IndexJob>(QUEUE, { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 2 }, async (jobs) => {
    for (const job of jobs) {
      try {
        await indexFile(job.data.fileId);
      } catch (err) {
        console.error(`[indexing] file ${job.data.fileId} failed (attempt ${job.retryCount + 1}/${job.retryLimit + 1}):`, err);
        if (job.retryCount >= job.retryLimit) await setStatus(job.data.fileId, 'FAILED');
        throw err; // lets pg-boss schedule the retry
      }
    }
  });

  // Load the models in the background; failures are retried lazily on first use.
  warmUpClip().catch((err) => console.error('[indexing] CLIP warm-up failed:', err));
  console.log('[indexing] image indexing worker started');
}

export async function stopIndexing(): Promise<void> {
  await boss?.stop({ graceful: true, timeout: 10_000 });
  boss = null;
}

/** Queues an image for indexing. Throws if the queue is not running (callers decide how to degrade). */
export async function enqueueIndexing(fileId: string): Promise<void> {
  if (!boss) throw new Error('Indexing queue is not running');
  await boss.send(QUEUE, { fileId });
}

async function setStatus(fileId: string, indexStatus: 'PENDING' | 'DONE' | 'FAILED') {
  await prisma.file.updateMany({ where: { id: fileId }, data: { indexStatus } }).catch(() => undefined);
}

async function indexFile(fileId: string): Promise<void> {
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) return; // purged from the trash before the job ran: nothing to do

  const filePath = path.join(FILE_ROOT, file.storedName);
  try {
    await fs.access(filePath);
  } catch {
    await setStatus(fileId, 'FAILED'); // missing on disk: retrying cannot help
    return;
  }

  const vector = toVectorLiteral(await embedImage(filePath));
  await prisma.$executeRaw`
    INSERT INTO "ImageEmbedding" ("fileId", "embedding", "model")
    VALUES (${file.id}::uuid, ${vector}::vector, ${CLIP_MODEL_ID})
    ON CONFLICT ("fileId") DO UPDATE
      SET "embedding" = EXCLUDED."embedding", "model" = EXCLUDED."model", "createdAt" = now()`;
  await setStatus(fileId, 'DONE');
}
