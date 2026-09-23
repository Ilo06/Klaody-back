import { Router } from 'express';
import { register, login } from '../controllers/auth.controller';
import { requireAdminForRegistration } from '../middleware/auth.middleware';

const router = Router();

// POST /auth/register – open only for bootstrap (no users yet);
// otherwise requires an authenticated admin.
router.post('/register', requireAdminForRegistration, register);

// POST /auth/login – obtain JWT
router.post('/login', login);

export default router;
