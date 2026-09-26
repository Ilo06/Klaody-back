import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { FILE_ROOT } from '../middleware/upload.middleware';
import { resolveShareToken } from '../services/share.service';
import { contentDisposition } from './file.controller';

export async function downloadShared(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const resolved = await resolveShareToken(token);
    if (!resolved.ok) {
      return res.status(404).json({ error: 'Share link not found or expired' });
    }

    const filePath = path.join(FILE_ROOT, resolved.storedName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Share link not found or expired' });
    }

    res.setHeader('Content-Type', resolved.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(resolved.name));
    res.setHeader('Content-Length', resolved.size.toString());

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}
