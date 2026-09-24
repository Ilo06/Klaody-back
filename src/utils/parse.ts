// Small input-parsing helpers shared by the controllers.
import { HttpError } from './errors';

/** Parses a positive integer id from a route/query/body value. Returns null if invalid. */
export function parseId(raw: unknown): number | null {
  const id = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Trims and validates a file/folder name (1–255 chars). Returns null if invalid. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return name.length >= 1 && name.length <= 255 ? name : null;
}

/**
 * Interprets the `folderId` / `parentId` query filter:
 *  - absent   -> everything (no filter)
 *  - "root"   -> top level only
 *  - integer  -> that folder's direct children
 */
export type FolderFilter =
  | { kind: 'all' }
  | { kind: 'root' }
  | { kind: 'id'; id: number }
  | { kind: 'invalid' };

export function parseFolderFilter(raw: unknown): FolderFilter {
  if (raw === undefined) return { kind: 'all' };
  if (raw === 'root') return { kind: 'root' };
  const id = parseId(raw);
  return id === null ? { kind: 'invalid' } : { kind: 'id', id };
}

/** Max number of ids accepted by one bulk request (files + folders combined). */
export const MAX_BULK_IDS = 1000;

/** Parses `{ fileIds?: number[], folderIds?: number[] }`; ids are de-duplicated. */
export function parseBulkIds(body: unknown): { fileIds: number[]; folderIds: number[] } {
  const b = (body ?? {}) as Record<string, unknown>;

  const read = (key: 'fileIds' | 'folderIds'): number[] => {
    const raw = b[key];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new HttpError(400, `${key} must be an array of ids`);
    const ids = raw.map((v) => (typeof v === 'number' ? parseId(v) : null));
    if (ids.some((id) => id === null)) {
      throw new HttpError(400, `${key} must only contain positive integers`);
    }
    return [...new Set(ids as number[])];
  };

  const fileIds = read('fileIds');
  const folderIds = read('folderIds');
  const total = fileIds.length + folderIds.length;
  if (total === 0) {
    throw new HttpError(400, 'fileIds and/or folderIds must contain at least one id');
  }
  if (total > MAX_BULK_IDS) {
    throw new HttpError(400, `Too many ids (max ${MAX_BULK_IDS} per request)`);
  }
  return { fileIds, folderIds };
}
