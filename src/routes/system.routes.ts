import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getStorage } from '../controllers/system.controller';

const router = Router();

router.use(authenticate);
router.get('/', getStorage);

export default router;