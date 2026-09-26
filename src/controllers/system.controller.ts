import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { getDiskUsage } from '../utils/disk';

// GET /storage — get disk usage and available space for the storage filesystem.
export async function getStorage(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const usage = await getDiskUsage();

    res.json({
      totalBytes: usage.totalBytes,
      freeBytes: usage.freeBytes,
      availableBytes: usage.availableBytes,
      reservedBytes: usage.reservedBytes,
      usableBytes: usage.usableBytes,
      usableGB: +(usage.usableBytes / 1024 ** 3).toFixed(2),
    });
  } catch (err) {
    next(err);
  }
}