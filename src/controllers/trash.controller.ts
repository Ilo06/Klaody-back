import { Response, NextFunction } from 'express';
import prisma from '../prisma/client';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { serializeFile, parseId } from './file.controller';

// GET /trash — list the caller's trashed files (and folders, once they exist)
export async function listTrash(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const files = await prisma.file.findMany({
      where: { userId: req.userId!, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });

    // TODO: return trashed folders once the Folder model is added
    res.json({ files: files.map(serializeFile), folders: [] });
  } catch (err) {
    next(err);
  }
}

// POST /trash/files/:id/restore — take a file out of the trash
export async function restoreFile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid file id' });
    }

    const file = await prisma.file.findFirst({
      where: { id, userId: req.userId!, deletedAt: { not: null } },
    });
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    
    const restored = await prisma.file.update({
      where: { id },
      data: { deletedAt: null },
    });
    res.json(serializeFile(restored));
  } catch (err) {
    next(err);
  }
}

// POST /trash/folders/:id/restore — placeholder until the Folder model exists
export async function restoreFolder(_req: AuthenticatedRequest, res: Response) {
  res.status(404).json({ error: 'Folder not found' });
}