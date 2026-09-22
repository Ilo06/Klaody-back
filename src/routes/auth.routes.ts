import { Router } from 'express';
import { register, login } from '../controllers/auth.controller';

const router = Router();

// POST /auth/register – create admin/user (single‑user system)
router.post('/register', register);

// POST /auth/login – obtain JWT
router.post('/login', login);

export default router;
