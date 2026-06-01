import logger from '../config/logger';
import { AdminUser } from '../models/AdminUser';
import { NotificationSequence } from '../models/NotificationSequence';
import { DashboardType } from '../types/dashboard';
import {
  TASK_POSTED_ROUND_ROBIN_EMAILS,
  normalizeAdminEmail,
  resolveAssignedDisplayName,
} from '../constants/taskAssignment';

export type TaskPostedRecipient = {
  userId: string;
  email: string;
  name: string;
};

const OPS_DASHBOARD_ROLES = ['operations_admin', 'operation_admin', 'operations'];

function hasActiveMainAdminOpsAccess(admin: {
  dashboardAccess?: Array<{
    dashboardType: string;
    status: string;
    role: string;
  }>;
}): boolean {
  return Boolean(
    admin.dashboardAccess?.some(
      (access) =>
        access.dashboardType === DashboardType.MAIN_ADMIN &&
        access.status === 'active' &&
        OPS_DASHBOARD_ROLES.includes(access.role),
    ),
  );
}

export async function listTaskPostedRecipients(): Promise<TaskPostedRecipient[]> {
  const admins = await AdminUser.find({
    status: 'active',
    email: { $in: [...TASK_POSTED_ROUND_ROBIN_EMAILS] },
  })
    .select('userId email name dashboardAccess')
    .lean();

  return TASK_POSTED_ROUND_ROBIN_EMAILS.map((email) => {
    const admin = admins.find(
      (row) => normalizeAdminEmail(row.email) === normalizeAdminEmail(email),
    );
    if (!admin || !hasActiveMainAdminOpsAccess(admin)) return null;
    const normalizedEmail = normalizeAdminEmail(admin.email);
    return {
      userId: admin.userId,
      email: normalizedEmail,
      name: resolveAssignedDisplayName(normalizedEmail, admin.name),
    };
  }).filter((row): row is TaskPostedRecipient => Boolean(row));
}

export async function getNextTaskPostedRecipient(): Promise<TaskPostedRecipient | null> {
  const activeRecipients = await listTaskPostedRecipients();

  if (activeRecipients.length === 0) {
    const admins = await AdminUser.find({
      email: { $in: [...TASK_POSTED_ROUND_ROBIN_EMAILS] },
    })
      .select('userId email status dashboardAccess')
      .lean();
    logger.error('No active operations admins found for task_posted round-robin', {
      expectedEmails: TASK_POSTED_ROUND_ROBIN_EMAILS,
      foundAdminEmails: admins.map((admin) => admin.email),
      foundAccess: admins.map((admin) => ({
        email: admin.email,
        status: admin.status,
        dashboardAccess: admin.dashboardAccess,
      })),
    });
    return null;
  }

  const sequence = await NotificationSequence.findOneAndUpdate(
    { key: 'task_posted_operations_round_robin' },
    { $inc: { value: 1 } },
    { new: false, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  const currentValue = sequence?.value || 0;
  const selected = activeRecipients[currentValue % activeRecipients.length];
  return selected || null;
}
