// Small input-parsing helpers shared by the controllers.
import { HttpError } from './errors';

/** Canonical UUID (v1–v8). Postgres rejects malformed uuids, so every id is checked before it reaches Prisma. */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_REGEX.test(raw);
}

/** Parses a UUID id from a route/query/body value (normalised to lower case). Returns null if invalid. */
export function parseId(raw: unknown): string | null {
  return isUuid(raw) ? raw.toLowerCase() : null;
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
 *  - UUID     -> that folder's direct children
 */
export type FolderFilter =
  | { kind: 'all' }
  | { kind: 'root' }
  | { kind: 'id'; id: string }
  | { kind: 'invalid' };

export function parseFolderFilter(raw: unknown): FolderFilter {
  if (raw === undefined) return { kind: 'all' };
  if (raw === 'root') return { kind: 'root' };
  const id = parseId(raw);
  return id === null ? { kind: 'invalid' } : { kind: 'id', id };
}

/** Max number of ids accepted by one bulk request (files + folders combined). */
export const MAX_BULK_IDS = 1000;

/** Parses `{ fileIds?: string[], folderIds?: string[] }`; ids are de-duplicated. */
export function parseBulkIds(body: unknown): { fileIds: string[]; folderIds: string[] } {
  const b = (body ?? {}) as Record<string, unknown>;

  const read = (key: 'fileIds' | 'folderIds'): string[] => {
    const raw = b[key];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new HttpError(400, `${key} must be an array of ids`);
    const ids = raw.map((v) => parseId(v));
    if (ids.some((id) => id === null)) {
      throw new HttpError(400, `${key} must only contain valid UUIDs`);
    }
    return [...new Set(ids as string[])];
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
