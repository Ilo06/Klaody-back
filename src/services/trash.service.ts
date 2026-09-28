import fs from 'fs';
import path from 'path';
import prisma from '../prisma/client';
import { FILE_ROOT } from '../middleware/upload.middleware';
import { siblingNameTaken, collectSubtreeIds } from '../utils/folders';

// Trash logic shared by the single-item routes (DELETE /files/:id, POST /trash/files/:id/restore, …)
// and the bulk routes (POST /trash, POST /trash/restore, POST /trash/restore-all, DELETE /trash).

export type ItemType = 'file' | 'folder';

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; status: 404 | 409; error: string };

export type BulkResult = {
  succeeded: { type: ItemType; id: string }[];
  failed: { type: ItemType; id: string; status: 404 | 409; error: string }[];
};

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = (status: 404 | 409, error: string): Outcome<never> => ({ ok: false, status, error });

function sameInstant(a: Date | null, b: Date | null): boolean {
  return a !== null && b !== null && a.getTime() === b.getTime();
}

// ---------------------------------------------------------------------------
// Move to trash
// ---------------------------------------------------------------------------

/**
 * Moves a file to the trash with the timestamp `now`.
 * An item already trashed with that very timestamp counts as success: it means an earlier
 * item of the same bulk request (e.g. its parent folder) already took it along.
 */
export async function trashFile(userId: string, id: string, now: Date): Promise<Outcome<void>> {
  const file = await prisma.file.findFirst({ where: { id, userId }, select: { id: true, deletedAt: true } });
  if (!file) return fail(404, 'File not found');
  if (file.deletedAt) {
    return sameInstant(file.deletedAt, now) ? ok(undefined) : fail(404, 'File not found');
  }
  await prisma.file.update({ where: { id }, data: { deletedAt: now } });
  return ok(undefined);
}

/**
 * Moves a folder and everything live inside it to the trash. The folder, its live sub-folders
 * and their live files all get the same `deletedAt`, so a restore brings back exactly that batch.
 */
export async function trashFolder(userId: string, id: string, now: Date): Promise<Outcome<void>> {
  const folder = await prisma.folder.findFirst({ where: { id, userId }, select: { id: true, deletedAt: true } });
  if (!folder) return fail(404, 'Folder not found');
  if (folder.deletedAt) {
    return sameInstant(folder.deletedAt, now) ? ok(undefined) : fail(404, 'Folder not found');
  }

  const ids = await collectSubtreeIds(userId, id, null);
  await prisma.$transaction([
    prisma.folder.updateMany({ where: { id: { in: ids }, userId, deletedAt: null }, data: { deletedAt: now } }),
    prisma.file.updateMany({ where: { folderId: { in: ids }, userId, deletedAt: null }, data: { deletedAt: now } }),
  ]);
  return ok(undefined);
}

/** Bulk version: every item is attempted, results are reported per item. */
export async function trashMany(userId: string, fileIds: string[], folderIds: string[]): Promise<BulkResult> {
  const now = new Date(); // shared, so items covered by a parent folder in the same request still succeed
  const result: BulkResult = { succeeded: [], failed: [] };

  for (const id of fileIds) {
    const r = await trashFile(userId, id, now);
    if (r.ok) result.succeeded.push({ type: 'file', id });
    else result.failed.push({ type: 'file', id, status: r.status, error: r.error });
  }
  for (const id of folderIds) {
    const r = await trashFolder(userId, id, now);
    if (r.ok) result.succeeded.push({ type: 'folder', id });
    else result.failed.push({ type: 'folder', id, status: r.status, error: r.error });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** Restores a trashed file. 409 if its parent folder is still trashed. */
export async function restoreFile(userId: string, id: string) {
  const file = await prisma.file.findFirst({
    where: { id, userId, deletedAt: { not: null } },
    include: { folder: { select: { deletedAt: true } } },
  });
  if (!file) return fail(404, 'File not found');
  if (file.folder?.deletedAt) return fail(409, 'Parent folder is in the trash; restore it first');

  const restored = await prisma.file.update({ where: { id }, data: { deletedAt: null } });
  return ok(restored);
}


export async function restoreFolder(userId: string, id: string) {
  const folder = await prisma.folder.findFirst({
    where: { id, userId, deletedAt: { not: null } },
    include: { parent: { select: { deletedAt: true } } },
  });
  if (!folder || !folder.deletedAt) return fail(404, 'Folder not found');
  if (folder.parent?.deletedAt) return fail(409, 'Parent folder is in the trash; restore it first');
  if (await siblingNameTaken(userId, folder.parentId, folder.name)) {
    return fail(409, 'A folder with this name already exists in the destination');
  }

  const batch = folder.deletedAt;
  const ids = await collectSubtreeIds(userId, id, batch);

  await prisma.$transaction([
    prisma.folder.updateMany({ where: { id: { in: ids }, userId, deletedAt: batch }, data: { deletedAt: null } }),
    prisma.file.updateMany({ where: { folderId: { in: ids }, userId, deletedAt: batch }, data: { deletedAt: null } }),
  ]);

  const restored = await prisma.folder.findUniqueOrThrow({ where: { id } });
  return ok({ folder: restored, restoredFolderIds: ids });
}

//Orders folder ids so that a folder always comes after its parent when both are in the list
async function parentsFirst(userId: string, ids: string[]): Promise<string[]> {
  const rows = await prisma.folder.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, parentId: true },
  });
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));

  const depth = (id: string): number => {
    let d = 0;
    let current = parentOf.get(id) ?? null;
    while (current !== null && parentOf.has(current) && d <= ids.length) {
      d++;
      current = parentOf.get(current) ?? null;
    }
    return d;
  };
  return [...ids].sort((a, b) => depth(a) - depth(b));
}

export async function restoreMany(userId: string, fileIds: string[], folderIds: string[]): Promise<BulkResult> {
  const result: BulkResult = { succeeded: [], failed: [] };
  const restoredFolders = new Set<string>();

  for (const id of await parentsFirst(userId, folderIds)) {
    const r = await restoreFolder(userId, id);
    if (r.ok) {
      r.value.restoredFolderIds.forEach((fid) => restoredFolders.add(fid));
      result.succeeded.push({ type: 'folder', id });
    } else if (r.status === 404 && restoredFolders.has(id)) {
      result.succeeded.push({ type: 'folder', id });
    } else {
      result.failed.push({ type: 'folder', id, status: r.status, error: r.error });
    }
  }

  for (const id of fileIds) {
    const r = await restoreFile(userId, id);
    if (r.ok) {
      result.succeeded.push({ type: 'file', id });
      continue;
    }
    // Live now, inside a folder restored by this request => it came back with that folder.
    const live =
      r.status === 404
        ? await prisma.file.findFirst({ where: { id, userId, deletedAt: null }, select: { folderId: true } })
        : null;
    if (live && live.folderId !== null && restoredFolders.has(live.folderId)) {
      result.succeeded.push({ type: 'file', id });
    } else {
      result.failed.push({ type: 'file', id, status: r.status, error: r.error });
    }
  }
  return result;
}

export type TrashFilters = {
  type?: ItemType;
  name?: { contains: string; mode: 'insensitive' };
  deletedAt: { not: null } | { gte?: Date; lte?: Date };
};


export async function findTopLevelTrash(
  userId: string,
  { type, name, deletedAt }: TrashFilters = { deletedAt: { not: null } }
) {
  const [files, folders] = await Promise.all([
    type === 'folder'
      ? []
      : prisma.file.findMany({
          where: { userId, deletedAt, ...(name ? { name } : {}) },
          include: { folder: { select: { deletedAt: true } } },
          orderBy: { deletedAt: 'desc' },
        }),
    type === 'file'
      ? []
      : prisma.folder.findMany({
          where: { userId, deletedAt, ...(name ? { name } : {}) },
          include: { parent: { select: { deletedAt: true } } },
          orderBy: { deletedAt: 'desc' },
        }),
  ]);

  return {
    files: files.filter((f) => !sameInstant(f.folder?.deletedAt ?? null, f.deletedAt)),
    folders: folders.filter((f) => !sameInstant(f.parent?.deletedAt ?? null, f.deletedAt)),
  };
}

// Restores every top-level trashed item (each one brings back its own batch). 
export async function restoreAll(userId: string): Promise<BulkResult> {
  const { files, folders } = await findTopLevelTrash(userId);
  return restoreMany(
    userId,
    files.map((f) => f.id),
    folders.map((f) => f.id)
  );
}

// Empty trash (permanent!)
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function removeStoredFiles(storedNames: string[]): Promise<void> {
  for (const batch of chunk(storedNames, 50)) {
    const results = await Promise.allSettled(
      batch.map((name) => fs.promises.unlink(path.join(FILE_ROOT, name)))
    );
    results.forEach((r, i) => {
      if (r.status === 'rejected' && (r.reason as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Could not remove stored file ${batch[i]}:`, r.reason);
      }
    });
  }
}

// Permanently delete everything in trash, clean database first, then the disk
export async function emptyTrash(userId: string) {
  const { files, folders } = await prisma.$transaction(
    async (tx) => {
      const files = await tx.file.findMany({
        where: { userId, deletedAt: { not: null } },
        select: { id: true, storedName: true },
      });
      const folders = await tx.folder.findMany({
        where: { userId, deletedAt: { not: null } },
        select: { id: true },
      });

      for (const ids of chunk(files.map((f) => f.id), 10_000)) {
        await tx.file.deleteMany({ where: { id: { in: ids } } });
      }
      for (const ids of chunk(folders.map((f) => f.id), 10_000)) {
        await tx.folder.deleteMany({ where: { id: { in: ids } } });
      }
      return { files, folders };
    },
    { timeout: 60_000 }
  );

  // Only touch the disk once the rows are gone, so a failure can leave an orphan
  await removeStoredFiles(files.map((f) => f.storedName));

  return { deletedFiles: files.length, deletedFolders: folders.length };
}
