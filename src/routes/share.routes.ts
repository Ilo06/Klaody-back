import { Router } from 'express';
import { downloadShared } from '../controllers/share.controller';

const router = Router();

// No `authenticate` middleware here — this is the public, tokenized download route.
router.get('/:token', downloadShared);

export default router;
