import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';
import {
  listFiles,
  searchFiles,
  uploadFile,
  downloadFile,
  previewFile,
  getFileDetails,
  renameFile,
  moveFile,
  deleteFile,
  createShare,
} from '../controllers/file.controller';
import {
  createUploadSession,
  getUploadSession,
  uploadChunk,
  completeUpload,
  abortUpload,
} from '../controllers/upload-session.controller';

const router = Router();

router.use(authenticate);

router.get('/', listFiles);
router.get('/search', searchFiles); // must stay before '/:id'
router.post('/', upload.single('file'), uploadFile);

// Resumable chunked upload (large files)  must stay before '/:id'
router.post('/uploads', createUploadSession);
router.get('/uploads/:id', getUploadSession);
router.put('/uploads/:id/chunks/:index', uploadChunk);
router.post('/uploads/:id/complete', completeUpload);
router.delete('/uploads/:id', abortUpload);

router.get('/:id', downloadFile);
router.get('/:id/preview', previewFile); // reduced-size copy of an image (the download stays full resolution)
router.get('/:id/details', getFileDetails); // EXIF / GPS / dimensions of an image
router.patch('/:id/rename', renameFile);
router.patch('/:id/move', moveFile);
router.delete('/:id', deleteFile);
router.post('/:id/share', createShare);

export default router;
