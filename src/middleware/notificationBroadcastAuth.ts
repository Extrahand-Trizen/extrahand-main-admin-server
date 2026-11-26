import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { DashboardType } from '../types/dashboard';
import {
  getNotificationBroadcastAccessToken,
  matchesNotificationBroadcastAccessToken,
} from '../utils/notificationBroadcastAccessToken';
import { requireOperationsAdminOrSuperAdmin, verifyAuth } from './auth';

export function notificationBroadcastAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const providedToken = getNotificationBroadcastAccessToken(
    req.header('authorization'),
  );
  if (matchesNotificationBroadcastAccessToken(providedToken, env.NOTIFICATION_BROADCAST_ACCESS_TOKEN)) {
    req.admin = {
      userId: 'notification-broadcast-api',
      email: 'notification-broadcast-api',
      name: 'Notification Broadcast API',
      dashboardType: DashboardType.MAIN_ADMIN,
      role: 'notification_broadcast_service',
      isSuperAdmin: false,
      permissions: ['notifications.broadcast'],
    };
    next();
    return;
  }

  verifyAuth(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    requireOperationsAdminOrSuperAdmin(req, res, next);
  });
}
