import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';
import {
  listFiles,
  uploadFile,
  downloadFile,
  renameFile,
  moveFile,
  deleteFile,
  createShare,
} from '../controllers/file.controller';

const router = Router();

router.use(authenticate);

router.get('/', listFiles);
router.post('/', upload.single('file'), uploadFile);
router.get('/:id', downloadFile);
router.patch('/:id/rename', renameFile);
router.patch('/:id/move', moveFile);
router.delete('/:id', deleteFile);
router.post('/:id/share', createShare);

export default router;
