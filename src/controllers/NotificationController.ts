import { Request, Response } from 'express';
import axios from 'axios';
import logger from '../config/logger';
import { env } from '../config/env';
import { AdminUser } from '../models/AdminUser';
import { AdminNotification } from '../models/AdminNotification';
import { DashboardType } from '../types/dashboard';

const MAX_LIST_LIMIT = 100;

type NotificationEventType = 'aadhaar_verification_failed' | 'task_posted';

type NotificationEventPayload = {
  type: NotificationEventType;
  userId?: string;
  userName?: string;
  userEmail?: string;
  taskId?: string;
  taskTitle?: string;
  occurredAt?: string;
};

function buildNotificationPayload(event: NotificationEventPayload) {
  if (event.type === 'aadhaar_verification_failed') {
    return {
      title: 'Aadhaar verification failed',
      message: event.userName
        ? `${event.userName}'s Aadhaar verification failed.`
        : 'Aadhaar verification failed for a user.',
      linkUrl: event.userId ? `/users/${encodeURIComponent(event.userId)}` : undefined,
    };
  }

  return {
    title: 'Task posted',
    message: event.taskTitle
      ? `New task posted: ${event.taskTitle}.`
      : 'A new task has been posted.',
    linkUrl: event.taskId ? `/tasks/${encodeURIComponent(event.taskId)}` : undefined,
  };
}

function visibleNotificationsQuery(dashboardType: DashboardType, userId: string) {
  return {
    dashboardType,
    $or: [
      { targetAdminUserIds: { $exists: false } },
      { targetAdminUserIds: { $size: 0 } },
      { targetAdminUserIds: userId },
    ],
  };
}

async function getAlertRecipientUserIds(): Promise<string[]> {
  const alertEmail = env.ADMIN_ALERT_EMAIL?.trim().toLowerCase();
  if (!alertEmail) return [];

  const admins = await AdminUser.find({
    email: alertEmail,
    status: 'active',
  })
    .select('userId dashboardAccess isSuperAdmin')
    .lean();

  return admins
    .filter((admin) => {
      if (admin.isSuperAdmin) return true;
      return admin.dashboardAccess?.some(
        (access) =>
          access.dashboardType === DashboardType.MAIN_ADMIN &&
          access.status === 'active'
      );
    })
    .map((admin) => admin.userId);
}

async function sendAdminAlertEmail(notification: {
  title: string;
  message: string;
  linkUrl?: string;
  metadata?: Record<string, any>;
}) {
  if (!env.EMAIL_SERVICE_URL) {
    logger.warn('Email service URL not configured; skipping admin alert email');
    return;
  }

  const emailServiceAuthToken = env.EMAIL_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN;
  const to = env.ADMIN_ALERT_EMAIL;

  try {
    await axios.post(
      `${env.EMAIL_SERVICE_URL}/api/v1/email/send`,
      {
        to,
        template: 'admin_alert',
        data: {
          title: notification.title,
          message: notification.message,
          linkUrl: notification.linkUrl,
          metadata: notification.metadata,
        },
        metadata: {
          notificationCategory: 'system',
          type: 'admin_alert',
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Auth': emailServiceAuthToken,
        },
      }
    );
  } catch (error: any) {
    logger.error('Failed to send admin alert email', {
      error: error.message,
    });
  }
}

export class NotificationController {
  /**
   * GET /api/v1/notifications
   */
  static async listNotifications(req: Request, res: Response): Promise<void> {
    try {
      if (!req.admin) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const limit = Math.min(
        MAX_LIST_LIMIT,
        Math.max(1, Number(req.query.limit) || 20)
      );
      const unreadOnly = req.query.unreadOnly === 'true';
      const dashboardType = req.admin.dashboardType as DashboardType;
      const userId = req.admin.userId;

      const baseQuery: Record<string, any> = visibleNotificationsQuery(
        dashboardType,
        userId
      );
      if (unreadOnly) {
        baseQuery['readBy.userId'] = { $ne: userId };
      }

      const [notifications, unreadCount] = await Promise.all([
        AdminNotification.find(baseQuery)
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean(),
        AdminNotification.countDocuments({
          ...visibleNotificationsQuery(dashboardType, userId),
          'readBy.userId': { $ne: userId },
        }),
      ]);

      const data = notifications.map((notification) => {
        const readEntry = notification.readBy?.find((entry) => entry.userId === userId);
        return {
          id: String(notification._id),
          type: notification.type,
          title: notification.title,
          message: notification.message,
          linkUrl: notification.linkUrl,
          createdAt: notification.createdAt,
          isRead: Boolean(readEntry),
          readAt: readEntry?.readAt || null,
        };
      });

      res.json({
        success: true,
        data,
        unreadCount,
      });
    } catch (error: any) {
      logger.error('List notifications error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list notifications',
      });
    }
  }

  /**
   * POST /api/v1/notifications/:notificationId/read
   */
  static async markRead(req: Request, res: Response): Promise<void> {
    try {
      if (!req.admin) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const { notificationId } = req.params;
      const userId = req.admin.userId;
      const dashboardType = req.admin.dashboardType as DashboardType;

      await AdminNotification.updateOne(
        {
          _id: notificationId,
          ...visibleNotificationsQuery(dashboardType, userId),
          'readBy.userId': { $ne: userId },
        },
        { $push: { readBy: { userId, readAt: new Date() } } }
      );

      res.json({ success: true });
    } catch (error: any) {
      logger.error('Mark notification read error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark notification as read',
      });
    }
  }

  /**
   * POST /api/v1/notifications/read-all
   */
  static async markAllRead(req: Request, res: Response): Promise<void> {
    try {
      if (!req.admin) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const userId = req.admin.userId;
      const dashboardType = req.admin.dashboardType as DashboardType;

      await AdminNotification.updateMany(
        {
          ...visibleNotificationsQuery(dashboardType, userId),
          'readBy.userId': { $ne: userId },
        },
        { $push: { readBy: { userId, readAt: new Date() } } }
      );

      res.json({ success: true });
    } catch (error: any) {
      logger.error('Mark all notifications read error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark notifications as read',
      });
    }
  }

  /**
   * POST /api/v1/notifications/events
   * Service-auth only.
   */
  static async receiveEvent(req: Request, res: Response): Promise<void> {
    const payload = req.body as NotificationEventPayload;

    if (!payload?.type) {
      res.status(400).json({ success: false, error: 'Event type is required' });
      return;
    }

    if (!['aadhaar_verification_failed', 'task_posted'].includes(payload.type)) {
      res.status(400).json({ success: false, error: 'Unsupported event type' });
      return;
    }

    try {
      const notification = buildNotificationPayload(payload);
      const targetAdminUserIds = await getAlertRecipientUserIds();
      if (targetAdminUserIds.length === 0) {
        logger.warn(
          'No active main-admin recipient found for admin alert email; notification will be dashboard-wide',
          { alertEmail: env.ADMIN_ALERT_EMAIL }
        );
      }

      const created = await AdminNotification.create({
        type: payload.type,
        title: notification.title,
        message: notification.message,
        linkUrl: notification.linkUrl,
        dashboardType: DashboardType.MAIN_ADMIN,
        targetAdminUserIds,
        metadata: {
          userId: payload.userId,
          userName: payload.userName,
          userEmail: payload.userEmail,
          taskId: payload.taskId,
          taskTitle: payload.taskTitle,
          occurredAt: payload.occurredAt,
        },
      });

      await sendAdminAlertEmail({
        title: notification.title,
        message: notification.message,
        linkUrl: notification.linkUrl,
        metadata: created.metadata as Record<string, any>,
      });

      res.json({ success: true });
    } catch (error: any) {
      logger.error('Notification event error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process notification event',
      });
    }
  }
}
