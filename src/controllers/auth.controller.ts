import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
const JWT_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 7 days, in seconds

/** Helper to generate a signed JWT */
function generateToken(userId: number) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_SECONDS });
}

/**
 * Create a new user.
 * - First user ever created (bootstrap) is always admin.
 * - After that, `requireAdminForRegistration` middleware ensures only an
 *   admin can reach this handler, and that admin may optionally set
 *   `isAdmin` on the account being created.
 */
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, isAdmin } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const userCount = await prisma.user.count();
    const isBootstrap = userCount === 0;

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        isAdmin: isBootstrap ? true : Boolean(isAdmin),
      },
    });

    const token = generateToken(user.id);
    res.status(201).json({ token, expiresIn: JWT_EXPIRES_SECONDS });
  } catch (err) {
    next(err);
  }
}

/** Login – validate credentials and return JWT */
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);
    res.json({ token, expiresIn: JWT_EXPIRES_SECONDS });
  } catch (err) {
    next(err);
  }
}
