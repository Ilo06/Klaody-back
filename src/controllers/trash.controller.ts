import { Response, NextFunction } from 'express';
import prisma from '../prisma/client';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { parseId } from '../utils/parse';
import { serializeFile, serializeFolder } from '../utils/serialize';
import { siblingNameTaken, collectSubtreeIds } from '../utils/folders';

function sameInstant(a: Date | null, b: Date | null): boolean {
  return a !== null && b !== null && a.getTime() === b.getTime();
}

// GET /trash — list trashed items.
// Items trashed as part of a folder's batch (same deletedAt as their trashed parent) are hidden:
// they come back with the folder, so only the top-level trashed items are listed.
export async function listTrash(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;

    const [files, folders] = await Promise.all([
      prisma.file.findMany({
        where: { userId, deletedAt: { not: null } },
        include: { folder: { select: { deletedAt: true } } },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.folder.findMany({
        where: { userId, deletedAt: { not: null } },
        include: { parent: { select: { deletedAt: true } } },
        orderBy: { deletedAt: 'desc' },
      }),
    ]);

    res.json({
      files: files
        .filter((f) => !sameInstant(f.folder?.deletedAt ?? null, f.deletedAt))
        .map(serializeFile),
      folders: folders
        .filter((f) => !sameInstant(f.parent?.deletedAt ?? null, f.deletedAt))
        .map(serializeFolder),
    });
  } catch (err) {
    next(err);
  }
}

// POST /trash/files/:id/restore — take a file out of the trash.
// 409 if its parent folder is still trashed (restore the folder first).
export async function restoreFile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid file id' });
    }

    const file = await prisma.file.findFirst({
      where: { id, userId: req.userId!, deletedAt: { not: null } },
      include: { folder: { select: { deletedAt: true } } },
    });
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (file.folder?.deletedAt) {
      return res.status(409).json({ error: 'Parent folder is in the trash; restore it first' });
    }

    const restored = await prisma.file.update({ where: { id }, data: { deletedAt: null } });
    res.json(serializeFile(restored));
  } catch (err) {
    next(err);
  }
}

// POST /trash/folders/:id/restore — restore a folder together with the sub-folders and files
// that were trashed in the same batch (same deletedAt). Items trashed separately stay in the trash.
// 409 if the parent is still trashed, or a live sibling already has the same name.
export async function restoreFolder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid folder id' });
    }

    const folder = await prisma.folder.findFirst({
      where: { id, userId, deletedAt: { not: null } },
      include: { parent: { select: { deletedAt: true } } },
    });
    if (!folder || !folder.deletedAt) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    if (folder.parent?.deletedAt) {
      return res.status(409).json({ error: 'Parent folder is in the trash; restore it first' });
    }
    if (await siblingNameTaken(userId, folder.parentId, folder.name)) {
      return res
        .status(409)
        .json({ error: 'A folder with this name already exists in the destination' });
    }

    const batch = folder.deletedAt;
    const ids = await collectSubtreeIds(userId, id, batch);

    await prisma.$transaction([
      prisma.folder.updateMany({
        where: { id: { in: ids }, userId, deletedAt: batch },
        data: { deletedAt: null },
      }),
      prisma.file.updateMany({
        where: { folderId: { in: ids }, userId, deletedAt: batch },
        data: { deletedAt: null },
      }),
    ]);

    const restored = await prisma.folder.findUniqueOrThrow({ where: { id } });
    res.json(serializeFolder(restored));
  } catch (err) {
    next(err);
  }
}