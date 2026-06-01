import { Request, Response } from 'express';
import logger from '../config/logger';
import { AdminUser } from '../models/AdminUser';
import { AdminNotification } from '../models/AdminNotification';
import { NotificationSequence } from '../models/NotificationSequence';
import { DashboardType } from '../types/dashboard';

const MAX_LIST_LIMIT = 100;

type NotificationEventType = 'aadhaar_verification_failed' | 'task_posted';

type NotificationEventPayload = {
  type: NotificationEventType;
  userId?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  taskId?: string;
  taskTitle?: string;
  occurredAt?: string;
};

const TASK_POSTED_RECIPIENT_RULES = [
  {
    match: 'washing machine',
    emails: ['santhoshu@cognitbotz.com'],
  },
  {
    match: 'washroom cleaning',
    emails: ['tadembharat@cognitbotz.com'],
  },
];

const TASK_POSTED_ROUND_ROBIN_EMAILS = [
  'santhoshu@cognitbotz.com',
  'durgamshiva@cognitbotz.com',
  'tadembharat@cognitbotz.com',
];

const TASK_POSTED_EXCLUDED_EMAILS = [
  'nukaraju@trizenventures.com',
  'asishvenkat.a2004@gmail.com',
];

function buildNotificationPayload(event: NotificationEventPayload) {
  if (event.type === 'aadhaar_verification_failed') {
    return {
      title: 'Aadhaar verification failed',
      message: event.userName
        ? `${event.userName}'s Aadhaar verification failed.`
        : 'Aadhaar verification failed for a user.',
      linkUrl: event.userId
        ? `/users/${encodeURIComponent(event.userId)}?tab=verification`
        : undefined,
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

function normalizeRoutingText(value?: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function getOperationsAdminRecipientUserIds(): Promise<string[]> {
  const admins = await AdminUser.find({
    status: 'active',
    'dashboardAccess.dashboardType': DashboardType.MAIN_ADMIN,
    'dashboardAccess.status': 'active',
    'dashboardAccess.role': { $in: ['operations_admin', 'operation_admin'] },
  })
    .select('userId dashboardAccess isSuperAdmin')
    .lean();

  return admins
    .filter((admin) =>
      admin.dashboardAccess?.some(
        (access) =>
          access.dashboardType === DashboardType.MAIN_ADMIN &&
          access.status === 'active' &&
          ['operations_admin', 'operation_admin'].includes(access.role)
      )
    )
    .map((admin) => admin.userId);
}

async function getOperationsAdminRecipientUserIdsByEmail(emails: string[]): Promise<string[]> {
  const normalizedEmails = emails.map((email) => email.toLowerCase());
  const admins = await AdminUser.find({
    status: 'active',
    email: { $in: normalizedEmails },
    'dashboardAccess.dashboardType': DashboardType.MAIN_ADMIN,
    'dashboardAccess.status': 'active',
    'dashboardAccess.role': { $in: ['operations_admin', 'operation_admin'] },
  })
    .select('userId email dashboardAccess')
    .lean();

  return normalizedEmails
    .map((email) => admins.find((admin) => admin.email === email))
    .filter((admin) =>
      admin?.dashboardAccess?.some(
        (access) =>
          access.dashboardType === DashboardType.MAIN_ADMIN &&
          access.status === 'active' &&
          ['operations_admin', 'operation_admin'].includes(access.role),
      ),
    )
    .map((admin) => admin!.userId);
}

async function getNextTaskPostedRoundRobinRecipientUserIds(): Promise<string[]> {
  const admins = await AdminUser.find({
    status: 'active',
    email: { $in: TASK_POSTED_ROUND_ROBIN_EMAILS },
    'dashboardAccess.dashboardType': DashboardType.MAIN_ADMIN,
    'dashboardAccess.status': 'active',
    'dashboardAccess.role': { $in: ['operations_admin', 'operation_admin'] },
  })
    .select('userId email dashboardAccess')
    .lean();

  const activeRecipients = TASK_POSTED_ROUND_ROBIN_EMAILS.map((email) =>
    admins.find((admin) => admin.email === email),
  ).filter((admin) =>
    admin?.dashboardAccess?.some(
      (access) =>
        access.dashboardType === DashboardType.MAIN_ADMIN &&
        access.status === 'active' &&
        ['operations_admin', 'operation_admin'].includes(access.role),
    ),
  );

  if (activeRecipients.length === 0) return [];

  const sequence = await NotificationSequence.findOneAndUpdate(
    { key: 'task_posted_operations_round_robin' },
    { $inc: { value: 1 } },
    { new: false, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  const currentValue = sequence?.value || 0;
  const selected = activeRecipients[currentValue % activeRecipients.length];
  return selected ? [selected.userId] : [];
}

async function getTaskPostedRecipientUserIds(
  payload: NotificationEventPayload,
): Promise<string[]> {
  const taskTitle = normalizeRoutingText(payload.taskTitle);
  const matchedRule = TASK_POSTED_RECIPIENT_RULES.find((rule) =>
    taskTitle.includes(rule.match),
  );

  if (matchedRule) {
    const targetUserIds = await getOperationsAdminRecipientUserIdsByEmail(
      matchedRule.emails,
    );
    if (targetUserIds.length > 0) return targetUserIds;

    logger.warn('No active matching operations admin found for task routing rule', {
      taskTitle: payload.taskTitle,
      emails: matchedRule.emails,
    });
  }

  return getNextTaskPostedRoundRobinRecipientUserIds();
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
      const isExcludedFromTaskPosted = TASK_POSTED_EXCLUDED_EMAILS.includes(
        req.admin.email.toLowerCase(),
      );

      const baseQuery: Record<string, any> = visibleNotificationsQuery(
        dashboardType,
        userId
      );
      if (isExcludedFromTaskPosted) {
        baseQuery.type = { $ne: 'task_posted' };
      }
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
          ...(isExcludedFromTaskPosted ? { type: { $ne: 'task_posted' } } : {}),
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
      const targetAdminUserIds =
        payload.type === 'task_posted'
          ? await getTaskPostedRecipientUserIds(payload)
          : await getOperationsAdminRecipientUserIds();
      if (targetAdminUserIds.length === 0) {
        logger.warn(
          'No active target operations_admin users found for main-admin notification; skipping targeted notification',
        );
        res.json({ success: true, skipped: true });
        return;
      }

      await AdminNotification.create({
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
          userPhone: payload.userPhone,
          taskId: payload.taskId,
          taskTitle: payload.taskTitle,
          occurredAt: payload.occurredAt,
        },
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
