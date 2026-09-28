import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma/client';
import { isUuid } from '../utils/parse';

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

export interface AuthenticatedRequest extends Request {
  userId?: string;
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
    const payload = jwt.verify(token, JWT_SECRET) as { sub: unknown };
    // Tokens issued before the UUID migration carry a numeric `sub`: reject them so users log in again.
    if (!isUuid(payload.sub)) {
      return next({ status: 401, message: 'Invalid or expired token' });
    }
    req.userId = payload.sub;
    next();
  } catch (err) {
    return next({ status: 401, message: 'Invalid or expired token' });
  }
}


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

    let payload: { sub: unknown };
    try {
      payload = jwt.verify(parts[1], JWT_SECRET) as { sub: unknown };
    } catch (err) {
      return next({ status: 401, message: 'Invalid or expired token' });
    }
    if (!isUuid(payload.sub)) {
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
