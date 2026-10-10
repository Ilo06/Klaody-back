import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { FILE_ROOT } from '../middleware/upload.middleware';

// Reduced-size copies of images, used by the in-app preview (GET /files/:id/preview).
// The original file is never modified: GET /files/:id keeps returning it at full resolution.
// Previews are generated on first request and cached on disk under FILE_ROOT/.previews.

// 240 / 360 are thumbnail sizes (search result grid); the rest are for the full-screen preview.
export const PREVIEW_WIDTHS = [240, 360, 480, 720, 1080, 1600] as const; // buckets keep the cache small and reusable
export const DEFAULT_PREVIEW_WIDTH = 1080;
const PREVIEW_QUALITY = 75;
const THUMBNAIL_MAX_WIDTH = 360; // thumbnails are tiny on screen, so they can be compressed harder
const THUMBNAIL_QUALITY = 60;
const PREVIEW_DIR = path.join(FILE_ROOT, '.previews');

// GIF (animation) and SVG (vector) would lose something by being re-encoded; HEIC/RAW are not
// decodable by sharp's prebuilt libvips. Those are only available through the download route.
const PREVIEWABLE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export function isPreviewable(mimeType: string): boolean {
  return PREVIEWABLE_MIME.has(mimeType.toLowerCase());
}

/** Smallest bucket that is at least `requested` pixels wide (the largest one if it is bigger than all). */
export function snapPreviewWidth(requested: number): number {
  return PREVIEW_WIDTHS.find((width) => width >= requested) ?? PREVIEW_WIDTHS[PREVIEW_WIDTHS.length - 1];
}

function previewPath(fileId: string, width: number): string {
  return path.join(PREVIEW_DIR, `${fileId}_${width}.webp`);
}

// Concurrent requests for the same preview share a single resize job.
const inFlight = new Map<string, Promise<void>>();

async function generate(source: string, target: string, width: number): Promise<void> {
  await fs.promises.mkdir(PREVIEW_DIR, { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`; // written aside, then renamed: never serve a half-written file
  try {
    await sharp(source, { failOn: 'none' })
      .rotate() // applies the EXIF orientation (the re-encoded WebP carries no metadata)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: width <= THUMBNAIL_MAX_WIDTH ? THUMBNAIL_QUALITY : PREVIEW_QUALITY })
      .toFile(tmp);
    await fs.promises.rename(tmp, target);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** Returns the cached preview for a file (creating it if needed). Throws if the image cannot be decoded. */
export async function getPreview(
  fileId: string,
  storedName: string,
  width: number
): Promise<{ path: string; size: number }> {
  const target = previewPath(fileId, width);

  const cached = await fs.promises.stat(target).catch(() => null);
  if (cached) return { path: target, size: cached.size };

  let job = inFlight.get(target);
  if (!job) {
    job = generate(path.join(FILE_ROOT, storedName), target, width).finally(() => inFlight.delete(target));
    inFlight.set(target, job);
  }
  await job;

  const { size } = await fs.promises.stat(target);
  return { path: target, size };
}

/** Deletes every cached preview of the given files (called when they are permanently deleted). */
export async function removePreviews(fileIds: string[]): Promise<void> {
  const targets = fileIds.flatMap((id) => PREVIEW_WIDTHS.map((width) => previewPath(id, width)));
  const results = await Promise.allSettled(targets.map((target) => fs.promises.unlink(target)));
  results.forEach((r, i) => {
    if (r.status === 'rejected' && (r.reason as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Could not remove preview ${targets[i]}:`, r.reason);
    }
  });
}
