import { Request, Response } from 'express';
import logger from '../config/logger';
import { AdminNotification } from '../models/AdminNotification';
import { DashboardType } from '../types/dashboard';
import { normalizeTaskIdForAssignment } from '../constants/taskAssignment';
import { visibleNotificationsQuery } from '../utils/notificationVisibility';
import { getNextTaskPostedRecipient } from '../services/TaskPostedRecipientService';
import { persistTaskAssignment } from '../services/TaskAssignmentService';
import { createAadhaarKycAdminNotification } from '../services/AadhaarKycNotificationService';
import { buildKycReviewLinkUrl } from '../services/AadhaarKycRecipientService';

const MAX_LIST_LIMIT = 100;

type NotificationEventType =
  | 'aadhaar_verification_failed'
  | 'aadhaar_verification_under_review'
  | 'task_posted';

type NotificationEventPayload = {
  type: NotificationEventType;
  userId?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  status?: string;
  failureReason?: string;
  verificationId?: string;
  sessionId?: string;
  taskId?: string;
  taskTitle?: string;
  occurredAt?: string;
};

function buildNotificationPayload(event: NotificationEventPayload) {
  if (event.type === 'aadhaar_verification_failed') {
    return {
      title: 'Aadhaar verification failed',
      message: event.userName
        ? `${event.userName}'s Aadhaar verification failed${
            event.failureReason ? `: ${event.failureReason}` : '.'
          }`
        : 'Aadhaar verification failed for a user.',
      linkUrl: event.userId ? buildKycReviewLinkUrl(event.userId) : undefined,
    };
  }

  if (event.type === 'aadhaar_verification_under_review') {
    return {
      title: 'Aadhaar verification under review',
      message: event.userName
        ? `${event.userName}'s Aadhaar verification is under review.`
        : 'Aadhaar verification is under review for a user.',
      linkUrl: event.userId ? buildKycReviewLinkUrl(event.userId) : undefined,
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

export async function createTaskPostedAdminNotification(
  payload: Pick<
    NotificationEventPayload,
    'taskId' | 'taskTitle' | 'userId' | 'userName' | 'userEmail' | 'userPhone' | 'occurredAt'
  > & { assignedAt?: Date },
): Promise<{
  created: boolean;
  targetAdminUserIds: string[];
  notificationId?: string;
  taskId?: string;
  assignedTo?: { userId: string; email: string; name: string };
}> {
  const notification = buildNotificationPayload({ type: 'task_posted', ...payload });
  const recipient = await getNextTaskPostedRecipient();

  if (!recipient) {
    logger.warn('[TaskPostedInAppNotification][main-admin-server] No ops recipient for round-robin', {
      taskId: payload.taskId,
      taskTitle: payload.taskTitle,
    });
    return { created: false, targetAdminUserIds: [] };
  }

  const taskId = normalizeTaskIdForAssignment(payload.taskId);
  const targetAdminUserIds = [recipient.userId];

  const createdNotification = await AdminNotification.create({
    type: 'task_posted',
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
      taskId,
      taskTitle: payload.taskTitle,
      occurredAt: payload.occurredAt,
      assignedAt: payload.assignedAt || new Date(),
      assignedToUserId: recipient.userId,
      assignedToEmail: recipient.email,
      assignedToName: recipient.name,
    },
  });

  const notificationId = String(createdNotification._id);

  await persistTaskAssignment({
    taskId,
    taskTitle: payload.taskTitle,
    recipient,
    notificationId,
  });

  logger.info('[TaskPostedInAppNotification][main-admin-server] In-app notification saved after task posted', {
    service: 'extrahand-main-admin-server',
    notificationId,
    taskId,
    taskTitle: payload.taskTitle,
    assignedToUserId: recipient.userId,
    assignedToEmail: recipient.email,
    assignedToName: recipient.name,
    targetAdminUserIds,
    collections: {
      inAppNotification: 'adminnotifications',
      taskAssignment: 'task_assignments',
    },
  });

  return {
    created: true,
    targetAdminUserIds,
    notificationId,
    taskId,
    assignedTo: recipient,
  };
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
      const visibilityQuery = visibleNotificationsQuery(
        dashboardType,
        userId,
        req.admin.email,
      );

      const baseQuery: Record<string, any> = { ...visibilityQuery };
      if (unreadOnly) {
        baseQuery['readBy.userId'] = { $ne: userId };
      }

      const [notifications, unreadCount] = await Promise.all([
        AdminNotification.find(baseQuery)
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean(),
        AdminNotification.countDocuments({
          ...visibilityQuery,
          'readBy.userId': { $ne: userId },
        }),
      ]);

      const data = notifications.map((notification) => {
        const readEntry = notification.readBy?.find((entry) => entry.userId === userId);
        const kycUserId = String(notification.metadata?.userId || '').trim();
        const isAadhaarType =
          notification.type === 'aadhaar_verification_failed' ||
          notification.type === 'aadhaar_verification_under_review';
        const linkUrl =
          isAadhaarType && kycUserId
            ? buildKycReviewLinkUrl(kycUserId)
            : notification.linkUrl;

        return {
          id: String(notification._id),
          type: notification.type,
          title: notification.title,
          message: notification.message,
          linkUrl,
          kycUserId: isAadhaarType ? kycUserId : undefined,
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
          ...visibleNotificationsQuery(dashboardType, userId, req.admin.email),
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
          ...visibleNotificationsQuery(dashboardType, userId, req.admin.email),
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

    if (
      ![
        'aadhaar_verification_failed',
        'aadhaar_verification_under_review',
        'task_posted',
      ].includes(payload.type)
    ) {
      res.status(400).json({ success: false, error: 'Unsupported event type' });
      return;
    }

    try {
      if (payload.type === 'task_posted') {
        logger.info('[TaskPostedInAppNotification][main-admin-server] Received task_posted event from task-service', {
          service: 'extrahand-main-admin-server',
          taskId: payload.taskId,
          taskTitle: payload.taskTitle,
        });

        const result = await createTaskPostedAdminNotification(payload);
        if (!result.created) {
          logger.warn(
            '[TaskPostedInAppNotification][main-admin-server] Notification skipped — no active ops assignee',
            {
              service: 'extrahand-main-admin-server',
              eventType: payload.type,
              taskId: payload.taskId,
              taskTitle: payload.taskTitle,
            },
          );
          res.json({ success: true, skipped: true, reason: 'no_active_ops_recipient' });
          return;
        }

        res.json({
          success: true,
          data: {
            notificationId: result.notificationId,
            taskId: result.taskId,
            assignedTo: result.assignedTo,
            targetAdminUserIds: result.targetAdminUserIds,
          },
        });
        return;
      }

      const result = await createAadhaarKycAdminNotification({
        type: payload.type,
        userId: payload.userId,
        userName: payload.userName,
        userEmail: payload.userEmail,
        userPhone: payload.userPhone,
        status: payload.status,
        failureReason: payload.failureReason,
        verificationId: payload.verificationId,
        sessionId: payload.sessionId,
        occurredAt: payload.occurredAt,
      });

      if (!result.created) {
        res.json({ success: true, skipped: true, reason: 'no_active_aadhaar_kyc_recipient' });
        return;
      }

      res.json({
        success: true,
        data: {
          notificationId: result.notificationId,
          targetAdminUserIds: result.targetAdminUserIds,
        },
      });
    } catch (error: any) {
      logger.error('Notification event error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process notification event',
      });
    }
  }
}
