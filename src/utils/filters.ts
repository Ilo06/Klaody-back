import type { Prisma } from '@prisma/client';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Query = Record<string, unknown>;
type Order = 'asc' | 'desc';
type NameFilter = { contains: string; mode: 'insensitive' };
type DateRange = { gte?: Date; lte?: Date };

function text(raw: unknown, name: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw new HttpError(400, `${name} must be a single value`);
  const value = raw.trim();
  if (value.length > 255) throw new HttpError(400, `${name} is too long (max 255 characters)`);
  return value === '' ? undefined : value;
}

function nameFilter(raw: unknown): NameFilter | undefined {
  const value = text(raw, 'name');
  return value ? { contains: value, mode: 'insensitive' } : undefined;
}

function size(raw: unknown, name: string): bigint | undefined {
  const value = text(raw, name);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new HttpError(400, `${name} must be a non-negative integer (bytes)`);
  return BigInt(value);
}

function date(raw: unknown, name: string): Date | undefined {
  const value = text(raw, name);
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${name} must be an ISO 8601 date (e.g. 2026-09-24 or 2026-09-24T10:00:00Z)`);
  }
  return parsed;
}

/** Inclusive date range from two query params; undefined when neither is given. */
function dateRange(q: Query, afterKey: string, beforeKey: string): DateRange | undefined {
  const after = date(q[afterKey], afterKey);
  const before = date(q[beforeKey], beforeKey);
  if (after && before && after > before) {
    throw new HttpError(400, `${afterKey} must be earlier than ${beforeKey}`);
  }
  if (!after && !before) return undefined;
  return { ...(after ? { gte: after } : {}), ...(before ? { lte: before } : {}) };
}

function sort<T extends string>(
  q: Query,
  allowed: readonly T[],
  defaultBy: T,
  defaultOrder: Order
): { by: T; order: Order } {
  const by = text(q.sortBy, 'sortBy') ?? defaultBy;
  if (!(allowed as readonly string[]).includes(by)) {
    throw new HttpError(400, `sortBy must be one of: ${allowed.join(', ')}`);
  }
  const order = text(q.order, 'order') ?? defaultOrder;
  if (order !== 'asc' && order !== 'desc') {
    throw new HttpError(400, 'order must be "asc" or "desc"');
  }
  return { by: by as T, order };
}

//  GET /files ---

export function parseFileFilters(q: Query) {
  const where: Prisma.FileWhereInput = {};

  const name = nameFilter(q.name);
  if (name) where.name = name;

  // "image/png" = exact match, "image/*" = any image type (case-insensitive)
  const mime = text(q.mimeType, 'mimeType');
  if (mime) {
    where.mimeType = mime.endsWith('/*')
      ? { startsWith: mime.slice(0, -1), mode: 'insensitive' }
      : { equals: mime, mode: 'insensitive' };
  }

  const minSize = size(q.minSize, 'minSize');
  const maxSize = size(q.maxSize, 'maxSize');
  if (minSize !== undefined && maxSize !== undefined && minSize > maxSize) {
    throw new HttpError(400, 'minSize must be <= maxSize');
  }
  if (minSize !== undefined || maxSize !== undefined) {
    where.size = {
      ...(minSize !== undefined ? { gte: minSize } : {}),
      ...(maxSize !== undefined ? { lte: maxSize } : {}),
    };
  }

  const uploaded = dateRange(q, 'uploadedAfter', 'uploadedBefore');
  if (uploaded) where.uploadedAt = uploaded;

  const { by, order } = sort(q, ['name', 'size', 'uploadedAt'] as const, 'uploadedAt', 'desc');
  const orderBy = [{ [by]: order }, { id: 'asc' }] as Prisma.FileOrderByWithRelationInput[];

  return { where, orderBy };
}

//  GET /folders -

export function parseFolderFilters(q: Query) {
  const where: Prisma.FolderWhereInput = {};

  const name = nameFilter(q.name);
  if (name) where.name = name;

  const created = dateRange(q, 'createdAfter', 'createdBefore');
  if (created) where.createdAt = created;

  const { by, order } = sort(q, ['name', 'createdAt'] as const, 'name', 'asc');
  const orderBy = [{ [by]: order }, { id: 'asc' }] as Prisma.FolderOrderByWithRelationInput[];

  return { where, orderBy };
}

//  GET /trash ---

export function parseTrashFilters(q: Query) {
  const type = text(q.type, 'type');
  if (type !== undefined && type !== 'file' && type !== 'folder') {
    throw new HttpError(400, 'type must be "file" or "folder"');
  }

  const deleted = dateRange(q, 'deletedAfter', 'deletedBefore');

  return {
    type: type as 'file' | 'folder' | undefined,
    name: nameFilter(q.name),
    // A range on deletedAt already excludes nulls; otherwise just require "in the trash".
    deletedAt: (deleted ?? { not: null }) as DateRange | { not: null },
  };
}
