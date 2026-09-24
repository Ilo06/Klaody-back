import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { parseId, parseBulkIds } from '../utils/parse';
import { serializeFile, serializeFolder } from '../utils/serialize';
import { parseTrashFilters } from '../utils/filters';
import * as trash from '../services/trash.service';

// GET /trash — list trashed items.
// Items trashed as part of a folder's batch (same deletedAt as their trashed parent) are hidden:
// they come back with the folder, so only the top-level trashed items are listed.
// Filters: type (file|folder), name, deletedAfter, deletedBefore.
export async function listTrash(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const filters = parseTrashFilters(req.query);
    const { files, folders } = await trash.findTopLevelTrash(req.userId!, filters);
    res.json({ files: files.map(serializeFile), folders: folders.map(serializeFolder) });
  } catch (err) {
    next(err);
  }
}

// POST /trash — bulk move to trash. Body { fileIds?: number[], folderIds?: number[] }.
// Always 200 for a well-formed request; per-item outcomes are in { succeeded, failed }.
export async function bulkTrash(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { fileIds, folderIds } = parseBulkIds(req.body);
    res.json(await trash.trashMany(req.userId!, fileIds, folderIds));
  } catch (err) {
    next(err);
  }
}

// POST /trash/restore — bulk restore. Same body and response shape as POST /trash.
export async function bulkRestore(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { fileIds, folderIds } = parseBulkIds(req.body);
    res.json(await trash.restoreMany(req.userId!, fileIds, folderIds));
  } catch (err) {
    next(err);
  }
}

// POST /trash/restore-all — restore everything in the trash. Same response shape as POST /trash.
export async function restoreAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await trash.restoreAll(req.userId!));
  } catch (err) {
    next(err);
  }
}

// DELETE /trash — permanently delete everything in the trash (database rows and stored files).
export async function emptyTrash(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await trash.emptyTrash(req.userId!));
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

    const r = await trash.restoreFile(req.userId!, id);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json(serializeFile(r.value));
  } catch (err) {
    next(err);
  }
}

// POST /trash/folders/:id/restore — restore a folder together with the sub-folders and files
// that were trashed in the same batch. Items trashed separately stay in the trash.
// 409 if the parent is still trashed, or a live sibling already has the same name.
export async function restoreFolder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'invalid folder id' });
    }

    const r = await trash.restoreFolder(req.userId!, id);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json(serializeFolder(r.value.folder));
  } catch (err) {
    next(err);
  }
}
