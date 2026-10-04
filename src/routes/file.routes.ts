import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';
import {
  listFiles,
  searchFiles,
  uploadFile,
  downloadFile,
  previewFile,
  renameFile,
  moveFile,
  deleteFile,
  createShare,
} from '../controllers/file.controller';

const router = Router();

router.use(authenticate);

router.get('/', listFiles);
router.get('/search', searchFiles); // must stay before '/:id'
router.post('/', upload.single('file'), uploadFile);
router.get('/:id', downloadFile);
router.get('/:id/preview', previewFile); // reduced-size copy of an image (the download stays full resolution)
router.patch('/:id/rename', renameFile);
router.patch('/:id/move', moveFile);
router.delete('/:id', deleteFile);
router.post('/:id/share', createShare);

export default router;
