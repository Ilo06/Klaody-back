import fs from 'fs';
import { FILE_ROOT } from '../middleware/upload.middleware';

// Fraction of the *available* space we hold back as a safety buffer,
// so the disk never actually gets driven to 0 bytes free.
const RESERVE_RATIO = Number(process.env.STORAGE_RESERVE_RATIO ?? 0.1);

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;       // free space including blocks reserved for root
  availableBytes: number;  // free space actually usable by this process (bavail)
  reservedBytes: number;   // the 10% (or configured %) buffer withheld from availableBytes
  usableBytes: number;     // availableBytes - reservedBytes — what callers should treat as "free"
}

export async function getDiskUsage(): Promise<DiskUsage> {
  const stats = await fs.promises.statfs(FILE_ROOT);

  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bfree * stats.bsize;
  const availableBytes = stats.bavail * stats.bsize; // what a non-root process can actually use

  const reservedBytes = Math.floor(availableBytes * RESERVE_RATIO);
  const usableBytes = availableBytes - reservedBytes;

  return { totalBytes, freeBytes, availableBytes, reservedBytes, usableBytes };
}