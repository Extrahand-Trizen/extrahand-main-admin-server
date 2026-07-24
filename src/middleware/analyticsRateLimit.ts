import { Request, Response, NextFunction } from 'express';

const memoryStore = new Map<string, { count: number; resetAt: number }>();

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export function analyticsRateLimit(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `analytics:ratelimit:${req.admin?.userId || req.ip}`;
    const now = Date.now();

    const current = memoryStore.get(key);
    if (!current || current.resetAt <= now) {
      memoryStore.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    current.count += 1;
    memoryStore.set(key, current);

    if (current.count > options.max) {
      res.status(429).json({ success: false, error: 'Too many analytics requests. Please try again shortly.' });
      return;
    }

    next();
  };
}

