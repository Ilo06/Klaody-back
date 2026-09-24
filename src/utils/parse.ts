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
