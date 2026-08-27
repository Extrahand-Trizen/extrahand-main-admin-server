import { Request, Response } from 'express';
import logger from '../config/logger';
import { AdminNotification } from '../models/AdminNotification';
import { TaskCallRecord, TaskCallStatus } from '../models/TaskCallRecord';
import { DashboardType } from '../types/dashboard';
import { taskServiceClient } from '../services/TaskServiceClient';
import { userServiceClient } from '../services/UserServiceClient';

const STATUSES: TaskCallStatus[] = [
  'not_updated',
  'genuine',
  'not_genuine',
  'call_not_lifted',
  'follow_up',
  'completed',
];

const TASK_CALL_EXCLUDED_EMAILS = [
  'nukaraju@trizenventures.com',
];

function isOperationsAdmin(req: Request): boolean {
  if (req.admin?.isSuperAdmin) return true;
  return ['operations_admin', 'operation_admin', 'operations'].includes(
    req.admin?.role || '',
  );
}

function requireOperationsAdmin(req: Request, res: Response): boolean {
  if (!req.admin) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return false;
  }
  if (!isOperationsAdmin(req)) {
    res.status(403).json({ success: false, error: 'Operations admin access required' });
    return false;
  }
  return true;
}

function visibleTaskNotificationQuery(userId: string, taskId?: string) {
  const query: Record<string, any> = {
    type: 'task_posted',
    dashboardType: DashboardType.MAIN_ADMIN,
    targetAdminUserIds: userId,
  };
  if (taskId) query['metadata.taskId'] = taskId;
  return query;
}

function normalizeTask(task: any): any {
  const budget =
    typeof task?.budget === 'number'
      ? task.budget
      : Number(task?.budget?.amount ?? task?.budgetValue ?? 0);

  return {
    ...task,
    taskId: task?.taskId || task?._id || task?.id,
    customerId: task?.CustomerId || task?.customerId || task?.requesterId,
    budget: Number.isFinite(budget) ? budget : 0,
  };
}

function normalizeProfile(profile: any): any {
  return {
    id: profile?.profileId || profile?._id || profile?.id || profile?.uid,
    name: profile?.name || profile?.displayName || profile?.fullName || 'Unknown',
    phone:
      profile?.phone ||
      profile?.phoneNumber ||
      profile?.mobile ||
      profile?.mobileNumber ||
      profile?.contactNumber ||
      profile?.alternatePhone ||
      '',
  };
}

async function getTaskMap(taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, any>();
  try {
    const result = await taskServiceClient.getTasksBatch(taskIds);
    const rows = Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result?.tasks)
        ? result.tasks
      : Array.isArray(result?.profiles)
        ? result.profiles
        : [];
    return new Map(
      rows.map((row: any) => {
        const task = normalizeTask(row);
        return [String(task.taskId), task];
      }),
    );
  } catch (error) {
    logger.warn('Task calls batch task enrichment failed');
    return new Map<string, any>();
  }
}

async function getProfileMap(profileIds: string[]) {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  if (ids.length === 0) return new Map<string, any>();
  try {
    const result = await userServiceClient.getProfilesBatch(ids);
    const rows = Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result?.profiles)
        ? result.profiles
        : [];
    return new Map(
      rows.map((row: any) => {
        const profile = normalizeProfile(row);
        return [String(profile.id), profile];
      }),
    );
  } catch (error) {
    logger.warn('Task calls profile enrichment failed');
    return new Map<string, any>();
  }
}

function actor(req: Request) {
  return {
    userId: req.admin!.userId,
    email: req.admin!.email,
    name: req.admin!.name,
  };
}

function getCallAttempts(record: any): any[] {
  if (record?.callAttempts?.length) return record.callAttempts;
  if (!record?.status || record.status === 'not_updated') return [];
  return [{
    attemptedAt: record.updatedAt || record.createdAt,
    outcome: record.status,
    nextRetryAt: record.status === 'call_not_lifted' ? record.followUpDate || null : null,
  }];
}

export class TaskCallController {
  static async list(req: Request, res: Response): Promise<void> {
    if (!requireOperationsAdmin(req, res)) return;

    try {
      const userId = req.admin!.userId;
      if (TASK_CALL_EXCLUDED_EMAILS.includes(req.admin!.email.toLowerCase())) {
        res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 50, total: 0, pages: 1 },
        });
        return;
      }

      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const page = Math.max(1, Number(req.query.page) || 1);
      const search = String(req.query.search || '').trim().toLowerCase();
      const status = String(req.query.status || 'all');

      const notifications = await AdminNotification.find(
        visibleTaskNotificationQuery(userId),
      )
        .sort({ createdAt: -1 })
        .limit(300)
        .lean();

      const taskIds = Array.from(
        new Set(
          notifications
            .map((item) => String(item.metadata?.taskId || '').trim())
            .filter(Boolean),
        ),
      );

      const [records, taskMap] = await Promise.all([
        TaskCallRecord.find({ taskId: { $in: taskIds } }).lean(),
        getTaskMap(taskIds),
      ]);
      const recordMap = new Map(records.map((record) => [record.taskId, record]));
      const profileMap = await getProfileMap(
        notifications
          .map((notification) => {
            const taskId = String(notification.metadata?.taskId || '').trim();
            const task = taskMap.get(taskId);
            return (
              task?.customerId ||
              notification.metadata?.customerId ||
              notification.metadata?.CustomerId ||
              notification.metadata?.requesterId ||
              notification.metadata?.userId
            );
          })
          .filter(Boolean),
      );

      let rows = notifications
        .map((notification) => {
          const taskId = String(notification.metadata?.taskId || '').trim();
          if (!taskId) return null;
          const task = taskMap.get(taskId) || {};
          const record = recordMap.get(taskId);
          const customerId =
            task.customerId ||
            notification.metadata?.customerId ||
            notification.metadata?.CustomerId ||
            notification.metadata?.requesterId ||
            notification.metadata?.userId;
          const profile = profileMap.get(String(customerId || ''));
          return {
            notificationId: String(notification._id),
            taskId,
            userName: profile?.name || notification.metadata?.userName || 'Unknown',
            phone: profile?.phone || notification.metadata?.userPhone || '',
            taskTitle: task.title || notification.metadata?.taskTitle || 'Task',
            category: task.category || 'Not specified',
            notifiedOn: notification.createdAt,
            status: record?.status || 'not_updated',
            followUpDate: record?.followUpDate || null,
            nextRetryAt: getCallAttempts(record).at(-1)?.nextRetryAt || null,
            notesCount: record?.notes?.length || 0,
            updatedAt: record?.updatedAt || notification.createdAt,
          };
        })
        .filter(Boolean) as any[];

      if (status === 'pending_calls') {
        const now = Date.now();
        rows = rows.filter(
          (row) =>
            row.status === 'call_not_lifted' &&
            row.nextRetryAt &&
            new Date(row.nextRetryAt).getTime() <= now,
        );
      } else if (status === 'follow_up') {
        rows = rows.filter(
          (row) =>
            row.status === 'follow_up' ||
            (row.status === 'call_not_lifted' && row.nextRetryAt),
        );
      } else if (status !== 'all') {
        rows = rows.filter((row) => row.status === status);
      }
      if (search) {
        rows = rows.filter((row) =>
          [row.userName, row.phone, row.taskTitle, row.category, row.taskId]
            .join(' ')
            .toLowerCase()
            .includes(search),
        );
      }

      const total = rows.length;
      const start = (page - 1) * limit;

      res.json({
        success: true,
        data: rows.slice(start, start + limit),
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (error: any) {
      logger.error('List task calls error:', error);
      res.status(500).json({ success: false, error: 'Failed to list task calls' });
    }
  }

  static async get(req: Request, res: Response): Promise<void> {
    if (!requireOperationsAdmin(req, res)) return;

    try {
      const { taskId } = req.params;
      const notification = await AdminNotification.findOne(
        visibleTaskNotificationQuery(req.admin!.userId, taskId),
      ).lean();
      const record = await TaskCallRecord.findOne({ taskId }).lean();

      res.json({
        success: true,
        data: {
          taskId,
          notificationId: notification ? String(notification._id) : record?.notificationId,
          status: record?.status || 'not_updated',
          followUpDate: record?.followUpDate || null,
          nextRetryAt: getCallAttempts(record).at(-1)?.nextRetryAt || null,
          callAttempts: getCallAttempts(record),
          notes: record?.notes || [],
          updatedAt: record?.updatedAt || null,
        },
      });
    } catch (error: any) {
      logger.error('Get task call error:', error);
      res.status(500).json({ success: false, error: 'Failed to get task call' });
    }
  }

  static async updateStatus(req: Request, res: Response): Promise<void> {
    if (!requireOperationsAdmin(req, res)) return;

    try {
      const { taskId } = req.params;
      const status = req.body?.status as TaskCallStatus;
      const followUpDate = req.body?.followUpDate
        ? new Date(req.body.followUpDate)
        : null;
      const nextRetryAt = req.body?.nextRetryAt
        ? new Date(req.body.nextRetryAt)
        : null;

      if (!STATUSES.includes(status)) {
        res.status(400).json({ success: false, error: 'Invalid call status' });
        return;
      }
      if (status === 'follow_up' && (!followUpDate || Number.isNaN(followUpDate.getTime()))) {
        res.status(400).json({ success: false, error: 'Follow-up date is required' });
        return;
      }
      if (status === 'call_not_lifted' && (!nextRetryAt || Number.isNaN(nextRetryAt.getTime()))) {
        res.status(400).json({ success: false, error: 'Next retry time is required' });
        return;
      }

      const notification = await AdminNotification.findOne(
        visibleTaskNotificationQuery(req.admin!.userId, taskId),
      ).lean();

      const record = await TaskCallRecord.findOneAndUpdate(
        { taskId },
        {
          $set: {
            taskId,
            notificationId: notification ? String(notification._id) : undefined,
            status,
            followUpDate: status === 'follow_up' ? followUpDate : null,
            lastUpdatedBy: actor(req),
          },
          $push: {
            callAttempts: {
              attemptedAt: new Date(),
              outcome: status,
              nextRetryAt: status === 'call_not_lifted' ? nextRetryAt : null,
            },
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();

      res.json({ success: true, data: record });
    } catch (error: any) {
      logger.error('Update task call status error:', error);
      res.status(500).json({ success: false, error: 'Failed to update task call status' });
    }
  }

  static async addNote(req: Request, res: Response): Promise<void> {
    if (!requireOperationsAdmin(req, res)) return;

    try {
      const { taskId } = req.params;
      const note = String(req.body?.note || '').trim();
      if (!note) {
        res.status(400).json({ success: false, error: 'Note is required' });
        return;
      }

      const notification = await AdminNotification.findOne(
        visibleTaskNotificationQuery(req.admin!.userId, taskId),
      ).lean();

      const record = await TaskCallRecord.findOneAndUpdate(
        { taskId },
        {
          $set: {
            taskId,
            notificationId: notification ? String(notification._id) : undefined,
            lastUpdatedBy: actor(req),
          },
          $push: {
            notes: {
              note,
              createdBy: actor(req),
              createdAt: new Date(),
            },
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();

      res.status(201).json({ success: true, data: record });
    } catch (error: any) {
      logger.error('Add task call note error:', error);
      res.status(500).json({ success: false, error: 'Failed to add task call note' });
    }
  }
}
