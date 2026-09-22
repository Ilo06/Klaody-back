import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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
