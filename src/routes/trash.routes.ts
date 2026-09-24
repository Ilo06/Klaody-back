import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { listTrash, restoreFile, restoreFolder } from '../controllers/trash.controller';

const router = Router();

router.use(authenticate);

router.get('/', listTrash);
router.post('/files/:id/restore', restoreFile);
router.post('/folders/:id/restore', restoreFolder);

export default router;