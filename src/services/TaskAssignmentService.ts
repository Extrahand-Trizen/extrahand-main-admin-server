import logger from '../config/logger';
import { AdminNotification } from '../models/AdminNotification';
import { AdminUser } from '../models/AdminUser';
import { TaskAssignment } from '../models/TaskAssignment';
import type { TaskPostedRecipient } from './TaskPostedRecipientService';
import { DashboardType } from '../types/dashboard';
import {
  TASK_ASSIGNED_EMAIL_TO_NAME,
  normalizeAdminEmail,
  normalizeTaskIdForAssignment,
  resolveAssignedDisplayName,
} from '../constants/taskAssignment';

export type TaskAssigneeInfo = {
  userId: string;
  name: string;
  email: string;
};

export type TaskAssignmentMap = Map<string, TaskAssigneeInfo>;

function assignmentKey(taskId: string): string {
  return normalizeTaskIdForAssignment(taskId).toLowerCase();
}

function assigneeFromMetadata(
  metadata: Record<string, unknown> | undefined,
  targetAdminUserIds?: string[],
): TaskAssigneeInfo | null {
  const userId = String(
    metadata?.assignedToUserId || targetAdminUserIds?.[0] || '',
  ).trim();
  const email = normalizeAdminEmail(
    String(metadata?.assignedToEmail || ''),
  );
  const name = String(
    metadata?.assignedToName ||
      (email ? resolveAssignedDisplayName(email) : '') ||
      '',
  ).trim();

  if (!userId && !email) return null;

  return {
    userId: userId || email,
    email,
    name: name || resolveAssignedDisplayName(email),
  };
}

export async function persistTaskAssignment(input: {
  taskId: string;
  taskTitle?: string;
  recipient: TaskPostedRecipient;
  notificationId?: string;
}): Promise<void> {
  const taskId = normalizeTaskIdForAssignment(input.taskId);
  if (!taskId) return;

  await TaskAssignment.findOneAndUpdate(
    { taskId },
    {
      taskId,
      assignedToUserId: input.recipient.userId,
      assignedToEmail: input.recipient.email,
      assignedToName: input.recipient.name,
      notificationId: input.notificationId,
      taskTitle: input.taskTitle,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  logger.info('[TaskPostedInAppNotification][main-admin-server] Task assignment row saved', {
    service: 'extrahand-main-admin-server',
    collection: 'task_assignments',
    taskId,
    taskTitle: input.taskTitle,
    assignedToUserId: input.recipient.userId,
    assignedToEmail: input.recipient.email,
    assignedToName: input.recipient.name,
    notificationId: input.notificationId,
  });
}

/**
 * Build taskId -> assignee map (task_assignments first, then adminnotifications fallback).
 */
export async function loadTaskAssignmentMap(
  taskIds: string[],
): Promise<TaskAssignmentMap> {
  const wanted = new Set(
    taskIds.map((id) => assignmentKey(id)).filter(Boolean),
  );
  const map: TaskAssignmentMap = new Map();

  if (wanted.size === 0) return map;

  const lookupIds = [
    ...new Set(taskIds.map((id) => normalizeTaskIdForAssignment(id)).filter(Boolean)),
  ];
  const assignmentRows = await TaskAssignment.find({
    taskId: { $in: lookupIds },
  })
    .select('taskId assignedToUserId assignedToEmail assignedToName')
    .lean();

  for (const row of assignmentRows) {
    const tid = assignmentKey(row.taskId);
    if (!tid) continue;
    map.set(tid, {
      userId: row.assignedToUserId,
      email: normalizeAdminEmail(row.assignedToEmail),
      name: row.assignedToName,
    });
  }

  const stillMissing = [...wanted].filter((tid) => !map.has(tid));
  if (stillMissing.length === 0) return map;

  const notifications = await AdminNotification.find({
    type: 'task_posted',
    dashboardType: DashboardType.MAIN_ADMIN,
  })
    .select('metadata targetAdminUserIds createdAt')
    .sort({ createdAt: 1 })
    .limit(10000)
    .lean();

  const missingUserIds = new Set<string>();

  for (const notif of notifications) {
    const tid = assignmentKey(String(notif.metadata?.taskId || ''));
    if (!tid || !stillMissing.includes(tid)) continue;

    const fromMeta = assigneeFromMetadata(
      notif.metadata as Record<string, unknown> | undefined,
      notif.targetAdminUserIds,
    );
    if (fromMeta) {
      map.set(tid, fromMeta);
      if (fromMeta.userId && !fromMeta.email) {
        missingUserIds.add(fromMeta.userId);
      }
      continue;
    }

    const userId = notif.targetAdminUserIds?.[0];
    if (userId) {
      map.set(tid, { userId, name: '', email: '' });
      missingUserIds.add(userId);
    }
  }

  if (missingUserIds.size > 0) {
    const admins = await AdminUser.find({
      userId: { $in: [...missingUserIds] },
    })
      .select('userId email name')
      .lean();

    for (const [tid, info] of map.entries()) {
      if (info.name && info.email) continue;
      const admin = admins.find((row) => row.userId === info.userId);
      if (!admin) continue;
      map.set(tid, {
        userId: admin.userId,
        email: normalizeAdminEmail(admin.email),
        name: resolveAssignedDisplayName(admin.email, admin.name),
      });
    }
  }

  return map;
}

export function resolveAssigneeFilter(
  nameOrId: string,
): { userId: string | null; displayName: string | null; email: string | null } {
  const trimmed = nameOrId.trim();
  const lower = trimmed.toLowerCase();

  const emailEntry = Object.entries(TASK_ASSIGNED_EMAIL_TO_NAME).find(
    ([, name]) => name.toLowerCase() === lower,
  );
  if (emailEntry) {
    return {
      userId: null,
      displayName: emailEntry[1],
      email: normalizeAdminEmail(emailEntry[0]),
    };
  }

  return { userId: trimmed, displayName: trimmed, email: null };
}

export async function resolveAssigneeFilterUserId(
  filter: ReturnType<typeof resolveAssigneeFilter>,
): Promise<string | null> {
  if (filter.email) {
    const admin = await AdminUser.findOne({ email: filter.email })
      .select('userId')
      .lean();
    return admin?.userId || null;
  }
  if (filter.userId) {
    const byId = await AdminUser.findOne({ userId: filter.userId })
      .select('userId')
      .lean();
    if (byId?.userId) return byId.userId;
  }
  return null;
}

export function taskMatchesAssigneeFilter(
  assignee: TaskAssigneeInfo | null | undefined,
  filter: ReturnType<typeof resolveAssigneeFilter>,
  resolvedUserId: string | null,
): boolean {
  if (!assignee) return false;

  if (resolvedUserId && assignee.userId === resolvedUserId) return true;

  if (filter.email && assignee.email === filter.email) return true;

  if (filter.displayName && assignee.name.toLowerCase() === filter.displayName.toLowerCase()) {
    return true;
  }

  return false;
}
