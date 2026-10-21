import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getStorage, getBreakdown } from '../controllers/system.controller';

const router = Router();

router.use(authenticate);
router.get('/', getStorage);
router.get('/breakdown', getBreakdown);

export default router;
