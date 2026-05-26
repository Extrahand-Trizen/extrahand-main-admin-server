import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export function serviceAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const serviceAuthToken = env.SERVICE_AUTH_TOKEN;
  const providedToken = req.headers['x-service-auth'] as string | undefined;

  if (!serviceAuthToken) {
    res.status(500).json({
      success: false,
      error: 'Service auth token not configured',
    });
    return;
  }

  if (!providedToken) {
    res.status(401).json({
      success: false,
      error: 'Missing X-Service-Auth header',
    });
    return;
  }

  if (providedToken !== serviceAuthToken) {
    res.status(403).json({
      success: false,
      error: 'Invalid service authentication token',
    });
    return;
  }

  next();
}
