import { Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma/client';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { FILE_ROOT } from '../middleware/upload.middleware';

function serializeFile(file: {
  id: number;
  name: string;
  mimeType: string;
  size: bigint;
  uploadedAt: Date;
}) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: Number(file.size), 
    uploadedAt: file.uploadedAt,
  };
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /files — list the authenticated user's non-trashed files 
export async function listFiles(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const files = await prisma.file.findMany({
      where: { userId: req.userId!, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json(files.map(serializeFile));
  } catch (err) {
    next(err);
  }
}

// POST /files — upload (multer has already streamed the file to disk) 
export async function uploadFile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    const file = await prisma.file.create({
      data: {
        name: req.file.originalname,
        mimeType: req.file.mimetype || 'application/octet-stream',
        size: BigInt(req.file.size),
        storedName: req.file.filename,
        userId: req.userId!,
      },
    });

    res.status(201).json({ id: file.id, name: file.name, size: Number(file.size) });
  } catch (err) {
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
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.name)}"`
    );
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

// DELETE /files/:id — soft delete (moves to trash) 
export async function deleteFile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

    await prisma.file.update({ where: { id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
