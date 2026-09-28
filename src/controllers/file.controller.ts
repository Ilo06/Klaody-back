import { Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma/client';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { FILE_ROOT } from '../middleware/upload.middleware';
import { parseId, parseFolderFilter } from '../utils/parse';
import { serializeFile } from '../utils/serialize';
import { getOwnedFolder } from '../utils/folders';
import { parseFileFilters } from '../utils/filters';
import { trashFile } from '../services/trash.service';
import { createShareLink } from '../services/share.service';

// Builds an RFC 6266 / RFC 5987 compliant Content-Disposition header value.
// - `filename` is an ASCII-only fallback for legacy clients
// - `filename*` carries the real UTF-8 name, percent-encoded
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// Removes a file multer already wrote to disk
async function discardUpload(file?: Express.Multer.File) {
  if (file) await fs.promises.unlink(file.path).catch(() => undefined);
}

// GET /files — list the authenticated user's non-trashed files.
// Filters: folderId ("root" or an id; omitted = all), name, mimeType ("image/*" allowed),
// minSize, maxSize, uploadedAfter, uploadedBefore. Sorting: sortBy (name|size|uploadedAt), order.
export async function listFiles(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const filter = parseFolderFilter(req.query.folderId);
    if (filter.kind === 'invalid') {
      return res.status(400).json({ error: 'folderId must be a valid UUID or "root"' });
    }
    const { where: filters, orderBy } = parseFileFilters(req.query);

    const where: Prisma.FileWhereInput = { userId: req.userId!, deletedAt: null, ...filters };
    if (filter.kind === 'root') {
      where.folderId = null;
    } else if (filter.kind === 'id') {
      if (!(await getOwnedFolder(req.userId!, filter.id))) {
        return res.status(404).json({ error: 'Folder not found' });
      }
      where.folderId = filter.id;
    }

    const files = await prisma.file.findMany({ where, orderBy });
    res.json(files.map(serializeFile));
  } catch (err) {
    next(err);
  }
}

// POST /files — upload (multer has already streamed the file to disk).
// Optional multipart field `folderId` (omitted/empty = root).
// Note: multipart fields can arrive after the file part, so the folder is validated
// only once the file is on disk; on any rejection the stored file is removed.
export async function uploadFile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    let folderId: string | null = null;
    const rawFolderId = req.body?.folderId;
    if (rawFolderId !== undefined && rawFolderId !== '') {
      folderId = parseId(rawFolderId);
      if (folderId === null) {
        await discardUpload(req.file);
        return res.status(400).json({ error: 'invalid folderId' });
      }
      if (!(await getOwnedFolder(req.userId!, folderId))) {
        await discardUpload(req.file);
        return res.status(404).json({ error: 'Folder not found' });
      }
    }

    const file = await prisma.file.create({
      data: {
        name: req.file.originalname,
        mimeType: req.file.mimetype || 'application/octet-stream',
        size: BigInt(req.file.size),
        storedName: req.file.filename,
        folderId,
        userId: req.userId!,
      },
    });

    res.status(201).json({ id: file.id, name: file.name, size: Number(file.size), folderId: file.folderId });
  } catch (err) {
    await discardUpload(req.file); // don't leave an orphan on disk if the DB insert failed
    next(err);
  }
}

// GET /files/:id — stream the file back to the client
export async function downloadFile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid file id' });
    }

    const file = await prisma.file.findFirst({
      where: { id, userId: req.userId!, deletedAt: null },
    });
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.join(FILE_ROOT, file.storedName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(file.name));
    res.setHeader('Content-Length', file.size.toString());

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

// PATCH /files/:id/rename
export async function renameFile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid file id' });
    }

    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    const file = await prisma.file.findFirst({
      where: { id, userId: req.userId!, deletedAt: null },
    });
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const updated = await prisma.file.update({ where: { id }, data: { name } });
    res.json(serializeFile(updated));
  } catch (err) {
    next(err);
  }
}

// PATCH /files/:id/move — body { folderId: string | null } (null = root)
export async function moveFile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid file id' });
    }

    const rawFolderId = (req.body ?? {}).folderId;
    if (rawFolderId === undefined) {
      return res.status(400).json({ error: 'folderId is required (use null for root)' });
    }
    const targetId = rawFolderId === null ? null : parseId(rawFolderId);
    if (rawFolderId !== null && targetId === null) {
      return res.status(400).json({ error: 'invalid folderId' });
    }

    const file = await prisma.file.findFirst({
      where: { id, userId: req.userId!, deletedAt: null },
    });
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (targetId !== null && !(await getOwnedFolder(req.userId!, targetId))) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const updated = await prisma.file.update({ where: { id }, data: { folderId: targetId } });
    res.json(serializeFile(updated));
  } catch (err) {
    next(err);
  }
}

// DELETE /files/:id — soft delete (moves to trash)
export async function deleteFile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid file id' });
    }

    const r = await trashFile(req.userId!, id, new Date());
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// POST /files/:id/share — body { expiresIn?: number } (seconds; omitted = link never expires)
export async function createShare(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid file id' });
    }

    const rawExpiresIn = (req.body ?? {}).expiresIn;
    let expiresIn: number | undefined;
    if (rawExpiresIn !== undefined) {
      if (typeof rawExpiresIn !== 'number' || !Number.isInteger(rawExpiresIn) || rawExpiresIn <= 0) {
        return res.status(400).json({ error: 'expiresIn must be a positive integer number of seconds' });
      }
      expiresIn = rawExpiresIn;
    }

    const result = await createShareLink(req.userId!, id, expiresIn);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(201).json({ token: result.token, expiresAt: result.expiresAt });
  } catch (err) {
    next(err);
  }
}
