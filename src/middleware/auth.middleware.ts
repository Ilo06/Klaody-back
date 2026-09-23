import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

export interface AuthenticatedRequest extends Request {
  userId?: number;
}

export function authenticate(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return next({ status: 401, message: 'Missing Authorization header' });
  }
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return next({ status: 401, message: 'Invalid Authorization format' });
  }
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: number };
    req.userId = payload.sub;
    next();
  } catch (err) {
    return next({ status: 401, message: 'Invalid or expired token' });
  }
}

/**
 * Gates account creation.
 * - If no users exist yet, allows the request through unauthenticated
 *   (bootstrap: the very first account created becomes admin).
 * - Otherwise, requires a valid Bearer token belonging to an existing admin.
 */
export async function requireAdminForRegistration(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      return next();
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return next({ status: 401, message: 'Missing Authorization header' });
    }
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return next({ status: 401, message: 'Invalid Authorization format' });
    }

    let payload: { sub: number };
    try {
      payload = jwt.verify(parts[1], JWT_SECRET) as { sub: number };
    } catch (err) {
      return next({ status: 401, message: 'Invalid or expired token' });
    }

    const requester = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!requester || !requester.isAdmin) {
      return next({ status: 403, message: 'Only admins can create new accounts' });
    }

    req.userId = requester.id;
    next();
  } catch (err) {
    next(err);
  }
}
