import prisma from '../prisma/client';

// Storage breakdown by file type, for GET /storage/breakdown.
// Computed from the database (one GROUP BY on mimeType), so it never touches the disk.

export type CategoryKey = 'images' | 'videos' | 'audio' | 'pdf' | 'documents' | 'archives' | 'other';

const LABELS: Record<CategoryKey, string> = {
  images: 'Images',
  videos: 'Videos',
  audio: 'Audio',
  pdf: 'PDFs',
  documents: 'Documents',
  archives: 'Archives',
  other: 'Other',
};

const DOCUMENT_MIME_HINTS = [
  'msword',
  'wordprocessingml',
  'ms-excel',
  'spreadsheetml',
  'ms-powerpoint',
  'presentationml',
  'opendocument',
  'rtf',
  'json',
  'xml',
  'yaml',
  'csv',
];

const ARCHIVE_MIME_HINTS = ['zip', 'x-tar', 'gzip', 'x-7z', 'rar', 'x-bzip', 'x-xz'];

export function categorize(mimeType: string): CategoryKey {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('video/')) return 'videos';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || DOCUMENT_MIME_HINTS.some((hint) => mime.includes(hint))) return 'documents';
  if (ARCHIVE_MIME_HINTS.some((hint) => mime.includes(hint))) return 'archives';
  return 'other';
}

export interface BreakdownCategory {
  key: CategoryKey;
  label: string;
  bytes: number;
  count: number;
  /** Share of the user's (non-trashed) bytes, 0-100 with one decimal. */
  percentage: number;
}

export interface StorageBreakdown {
  totalBytes: number;
  totalFiles: number;
  categories: BreakdownCategory[];
  /** Still on disk until the trash is emptied, but not part of the percentages above. */
  trash: { bytes: number; count: number };
}

export async function getStorageBreakdown(userId: string): Promise<StorageBreakdown> {
  const [live, trashed] = await Promise.all([
    prisma.file.groupBy({
      by: ['mimeType'],
      where: { userId, deletedAt: null },
      _sum: { size: true },
      _count: { _all: true },
    }),
    prisma.file.aggregate({
      where: { userId, deletedAt: { not: null } },
      _sum: { size: true },
      _count: { _all: true },
    }),
  ]);

  const totals = new Map<CategoryKey, { bytes: number; count: number }>();
  for (const row of live) {
    const key = categorize(row.mimeType);
    const entry = totals.get(key) ?? { bytes: 0, count: 0 };
    entry.bytes += Number(row._sum.size ?? 0n);
    entry.count += row._count._all;
    totals.set(key, entry);
  }

  const totalBytes = [...totals.values()].reduce((sum, t) => sum + t.bytes, 0);
  const totalFiles = [...totals.values()].reduce((sum, t) => sum + t.count, 0);

  const categories: BreakdownCategory[] = [...totals.entries()]
    .map(([key, t]) => ({
      key,
      label: LABELS[key],
      bytes: t.bytes,
      count: t.count,
      percentage: totalBytes > 0 ? Math.round((t.bytes / totalBytes) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    totalBytes,
    totalFiles,
    categories,
    trash: { bytes: Number(trashed._sum.size ?? 0n), count: trashed._count._all },
  };
}
