import { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const tooMany = (_req: Request, res: Response) =>
  res.status(429).json({ error: 'Too many login attempts, please try again later' });

// Only failed logins count (successful ones are skipped), so a legitimate user is never locked out by normal use.
// 1) Per IP + email: stops password guessing against one account.
export const loginAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(process.env.LOGIN_MAX_PER_ACCOUNT) || 5,
  standardHeaders: 'draft-7', // sends RateLimit-* and Retry-After headers
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? '')}|${email}`;
  },
  handler: tooMany,
});

// 2) Per IP only: stops one client from trying many different emails.
export const loginIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(process.env.LOGIN_MAX_PER_IP) || 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: tooMany,
});