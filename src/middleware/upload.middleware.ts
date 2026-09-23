import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const FILE_ROOT = process.env.FILE_ROOT || './storage';

// Make sure the upload directory exists before multer tries to write into it.
fs.mkdirSync(FILE_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FILE_ROOT),
  filename: (_req, file, cb) => {
    // Never trust the client-supplied filename for the on-disk path
    // (path traversal, collisions). The original name is kept separately
    // in the DB (`File.name`) purely for display/download purposes.
    const unique = crypto.randomUUID();
    const ext = path.extname(file.originalname).slice(0, 16); // cap a pathological extension
    cb(null, `${unique}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5 GB per file, adjust as needed
});

export { FILE_ROOT };
