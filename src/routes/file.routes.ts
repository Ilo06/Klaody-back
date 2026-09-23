import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';
import {
  listFiles,
  uploadFile,
  downloadFile,
  renameFile,
  deleteFile,
} from '../controllers/file.controller';

const router = Router();

// Every route below requires a valid Bearer token, and only ever
// touches files owned by the requesting user (see controller queries).
router.use(authenticate);

router.get('/', listFiles);
router.post('/', upload.single('file'), uploadFile);
router.get('/:id', downloadFile);
router.patch('/:id/rename', renameFile);
router.delete('/:id', deleteFile);

export default router;
  