import { Router } from 'express';
import { register, login, me } from '../controllers/auth.controller';
import { authenticate, requireAdminForRegistration } from '../middleware/auth.middleware';

const router = Router();

// POST /auth/register – open only for bootstrap (no users yet);
// otherwise requires an authenticated admin.
router.post('/register', requireAdminForRegistration, register);

// POST /auth/login – obtain JWT
router.post('/login', login);

// GET /auth/me – current user's profile, incl. isAdmin (used by the
router.get('/me', authenticate, me);

export default router;
