import { Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { parseId, cleanName, parseFolderFilter } from '../utils/parse';
import { serializeFolder } from '../utils/serialize';
import { parseFolderFilters } from '../utils/filters';
import {
  getOwnedFolder,
  siblingNameTaken,
  isSelfOrDescendant,
  collectSubtreeIds,
} from '../utils/folders';

const NAME_CONFLICT = 'A folder with this name already exists in the destination';

// POST /folders — body { name, parentId? }
export async function createFolder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const { name: rawName, parentId: rawParentId } = req.body ?? {};

    const name = cleanName(rawName);
    if (!name) {
      return res.status(400).json({ error: 'name is required (1-255 characters)' });
    }

    let parentId: number | null = null;
    if (rawParentId !== undefined && rawParentId !== null) {
      parentId = parseId(rawParentId);
      if (parentId === null) {
        return res.status(400).json({ error: 'invalid parentId' });
      }
      if (!(await getOwnedFolder(userId, parentId))) {
        return res.status(404).json({ error: 'Folder not found' });
      }
    }

    if (await siblingNameTaken(userId, parentId, name)) {
      return res.status(409).json({ error: NAME_CONFLICT });
    }

    const folder = await prisma.folder.create({ data: { name, parentId, userId } });
    res.status(201).json(serializeFolder(folder));
  } catch (err) {
    next(err);
  }
}

// GET /folders — list non-trashed folders.
// Filters: parentId ("root" or an id; omitted = all), name, createdAfter, createdBefore.
// Sorting: sortBy (name|createdAt), order. Default: name asc.
export async function listFolders(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const filter = parseFolderFilter(req.query.parentId);
    if (filter.kind === 'invalid') {
      return res.status(400).json({ error: 'parentId must be a positive integer or "root"' });
    }

    const { where: filters, orderBy } = parseFolderFilters(req.query);

    const where: Prisma.FolderWhereInput = { userId, deletedAt: null, ...filters };
    if (filter.kind === 'root') {
      where.parentId = null;
    } else if (filter.kind === 'id') {
      if (!(await getOwnedFolder(userId, filter.id))) {
        return res.status(404).json({ error: 'Folder not found' });
      }
      where.parentId = filter.id;
    }

    const folders = await prisma.folder.findMany({ where, orderBy });
    res.json(folders.map(serializeFolder));
  } catch (err) {
    next(err);
  }
}

// PATCH /folders/:id/rename — body { name }
export async function renameFolder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid folder id' });
    }

    const name = cleanName((req.body ?? {}).name);
    if (!name) {
      return res.status(400).json({ error: 'name is required (1-255 characters)' });
    }

    const folder = await getOwnedFolder(userId, id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    if (await siblingNameTaken(userId, folder.parentId, name, id)) {
      return res.status(409).json({ error: NAME_CONFLICT });
    }

    const updated = await prisma.folder.update({ where: { id }, data: { name } });
    res.json(serializeFolder(updated));
  } catch (err) {
    next(err);
  }
}

// PATCH /folders/:id/move — body { parentId: number | null } (null = root)
export async function moveFolder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid folder id' });
    }

    const rawParentId = (req.body ?? {}).parentId;
    if (rawParentId === undefined) {
      return res.status(400).json({ error: 'parentId is required (use null for root)' });
    }
    const targetId = rawParentId === null ? null : parseId(rawParentId);
    if (rawParentId !== null && targetId === null) {
      return res.status(400).json({ error: 'invalid parentId' });
    }

    const folder = await getOwnedFolder(userId, id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    if (targetId !== null) {
      if (!(await getOwnedFolder(userId, targetId))) {
        return res.status(404).json({ error: 'Destination folder not found' });
      }
      if (await isSelfOrDescendant(userId, id, targetId)) {
        return res
          .status(400)
          .json({ error: 'Cannot move a folder into itself or one of its descendants' });
      }
    }

    if (await siblingNameTaken(userId, targetId, folder.name, id)) {
      return res.status(409).json({ error: NAME_CONFLICT });
    }

    const updated = await prisma.folder.update({ where: { id }, data: { parentId: targetId } });
    res.json(serializeFolder(updated));
  } catch (err) {
    next(err);
  }
}

// DELETE /folders/:id — move the folder and everything inside it to the trash.
export async function deleteFolder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid folder id' });
    }

    const folder = await getOwnedFolder(userId, id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const now = new Date();
    const ids = await collectSubtreeIds(userId, id, null);

    await prisma.$transaction([
      prisma.folder.updateMany({
        where: { id: { in: ids }, userId, deletedAt: null },
        data: { deletedAt: now },
      }),
      prisma.file.updateMany({
        where: { folderId: { in: ids }, userId, deletedAt: null },
        data: { deletedAt: now },
      }),
    ]);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
