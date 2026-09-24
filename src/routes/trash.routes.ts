import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  listTrash,
  bulkTrash,
  bulkRestore,
  restoreAll,
  emptyTrash,
  restoreFile,
  restoreFolder,
} from '../controllers/trash.controller';

const router = Router();

router.use(authenticate);

router.get('/', listTrash);
router.post('/', bulkTrash);
router.delete('/', emptyTrash);
router.post('/restore', bulkRestore);
router.post('/restore-all', restoreAll);
router.post('/files/:id/restore', restoreFile);
router.post('/folders/:id/restore', restoreFolder);

export default router;
