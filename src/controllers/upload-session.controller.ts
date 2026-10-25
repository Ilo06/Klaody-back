import { Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import prisma from '../prisma/client';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { FILE_ROOT } from '../middleware/upload.middleware';
import { parseId, cleanName } from '../utils/parse';
import { getOwnedFolder } from '../utils/folders';
import { getDiskUsage } from '../utils/disk';
import { HttpError } from '../utils/errors';
import { enqueueIndexing, isIndexable } from '../services/indexing.service';
import {
  CHUNK_SIZE,
  MAX_FILE_SIZE,
  createSessionFile,
  discardSession,
  newStoredName,
  partPath,
} from '../services/chunked-upload.service';

async function ownedSession(req: AuthenticatedRequest) {
  const id = parseId(req.params.id);
  if (id === null) throw new HttpError(400, 'invalid upload id');
  const session = await prisma.uploadSession.findFirst({ where: { id, userId: req.userId! } });
  if (!session) throw new HttpError(404, 'Upload not found');
  return session;
}

// POST /files/uploads — body { name, size, mimeType?, folderId? }
export async function createUploadSession(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const name = cleanName(body.name);
    if (name === null) throw new HttpError(400, 'name must be 1–255 characters');

    const size = body.size;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) {
      throw new HttpError(400, 'size must be a positive integer');
    }
    if (size > MAX_FILE_SIZE) throw new HttpError(413, 'File too large');

    let folderId: string | null = null;
    if (body.folderId !== undefined && body.folderId !== null && body.folderId !== '') {
      folderId = parseId(body.folderId);
      if (folderId === null) throw new HttpError(400, 'invalid folderId');
      if (!(await getOwnedFolder(req.userId!, folderId))) throw new HttpError(404, 'Folder not found');
    }

    const { usableBytes } = await getDiskUsage();
    if (size > usableBytes) throw new HttpError(507, 'Not enough storage space');

    const mimeType =
      typeof body.mimeType === 'string' && body.mimeType.trim() !== '' ? body.mimeType.trim() : 'application/octet-stream';
    const totalChunks = Math.ceil(size / CHUNK_SIZE);

    const session = await prisma.uploadSession.create({
      data: {
        userId: req.userId!,
        name,
        mimeType,
        size: BigInt(size),
        folderId,
        chunkSize: CHUNK_SIZE,
        totalChunks,
        storedName: newStoredName(name),
      },
    });

    try {
      await createSessionFile(size, session.id);
    } catch (err) {
      await discardSession(session.id);
      throw err;
    }

    res.status(201).json({ uploadId: session.id, chunkSize: CHUNK_SIZE, totalChunks, receivedChunks: [] });
  } catch (err) {
    next(err);
  }
}

// GET /files/uploads/:id — state of a session (used to resume)
export async function getUploadSession(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const session = await ownedSession(req);
    const chunks = await prisma.uploadChunk.findMany({
      where: { sessionId: session.id },
      select: { index: true },
      orderBy: { index: 'asc' },
    });
    res.json({
      uploadId: session.id,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      size: Number(session.size),
      receivedChunks: chunks.map((c) => c.index),
    });
  } catch (err) {
    next(err);
  }
}

// PUT /files/uploads/:id/chunks/:index — raw bytes (application/octet-stream) of exactly one chunk
export async function uploadChunk(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const session = await ownedSession(req);

    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
      throw new HttpError(400, 'invalid chunk index');
    }

    const offset = index * session.chunkSize;
    const expected = Math.min(session.chunkSize, Number(session.size) - offset);

    const contentLength = Number(req.headers['content-length']);
    if (!Number.isInteger(contentLength) || contentLength !== expected) {
      throw new HttpError(400, `chunk ${index} must be exactly ${expected} bytes`);
    }

    let received = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        if (received > expected) return cb(new HttpError(400, 'chunk larger than declared'));
        cb(null, chunk);
      },
    });

    await pipeline(req, counter, fs.createWriteStream(partPath(session.id), { flags: 'r+', start: offset }));

    if (received !== expected) throw new HttpError(400, 'incomplete chunk');

    await prisma.uploadChunk.upsert({
      where: { sessionId_index: { sessionId: session.id, index } },
      create: { sessionId: session.id, index },
      update: {},
    });

    res.json({ index, received });
  } catch (err) {
    next(err);
  }
}

// POST /files/uploads/:id/complete — assemble and register the file
export async function completeUpload(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const session = await ownedSession(req);

    const count = await prisma.uploadChunk.count({ where: { sessionId: session.id } });
    if (count !== session.totalChunks) {
      throw new HttpError(409, `Missing chunks (${count}/${session.totalChunks} received)`);
    }

    if (session.folderId !== null && !(await getOwnedFolder(req.userId!, session.folderId))) {
      await discardSession(session.id);
      throw new HttpError(404, 'Folder not found');
    }

    const part = partPath(session.id);
    const stat = await fs.promises.stat(part).catch(() => null);
    if (!stat || stat.size !== Number(session.size)) {
      await discardSession(session.id);
      throw new HttpError(409, 'Upload data is corrupted, please upload again');
    }

    const finalPath = path.join(FILE_ROOT, session.storedName);
    await fs.promises.rename(part, finalPath);

    const size = Number(session.size);
    const indexable = isIndexable(session.mimeType, size);

    let file;
    try {
      file = await prisma.file.create({
        data: {
          name: session.name,
          mimeType: session.mimeType,
          size: session.size,
          storedName: session.storedName,
          folderId: session.folderId,
          userId: req.userId!,
          indexStatus: indexable ? 'PENDING' : 'NONE',
        },
      });
    } catch (err) {
      await fs.promises.unlink(finalPath).catch(() => undefined); // no orphan on disk
      await prisma.uploadSession.deleteMany({ where: { id: session.id } });
      throw err;
    }

    await prisma.uploadSession.deleteMany({ where: { id: session.id } });

    let indexStatus: string = file.indexStatus;
    if (indexable) {
      try {
        await enqueueIndexing(file.id);
      } catch (queueErr) {
        console.error(`[indexing] could not queue file ${file.id}:`, queueErr);
        await prisma.file.update({ where: { id: file.id }, data: { indexStatus: 'FAILED' } }).catch(() => undefined);
        indexStatus = 'FAILED';
      }
    }

    res.status(201).json({ id: file.id, name: file.name, size, folderId: file.folderId, indexStatus });
  } catch (err) {
    next(err);
  }
}

// DELETE /files/uploads/:id — cancel and clean up
export async function abortUpload(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const session = await ownedSession(req);
    await discardSession(session.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
