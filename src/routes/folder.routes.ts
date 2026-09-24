import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  createFolder,
  listFolders,
  renameFolder,
  moveFolder,
  deleteFolder,
} from '../controllers/folder.controller';

const router = Router();

router.use(authenticate);

router.get('/', listFolders);
router.post('/', createFolder);
router.patch('/:id/rename', renameFolder);
router.patch('/:id/move', moveFolder);
router.delete('/:id', deleteFolder);

export default router;