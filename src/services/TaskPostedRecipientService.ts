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

export async function getNextTaskPostedRecipient(): Promise<TaskPostedRecipient | null> {
  const admins = await AdminUser.find({
    status: 'active',
    email: { $in: [...TASK_POSTED_ROUND_ROBIN_EMAILS] },
    'dashboardAccess.dashboardType': DashboardType.MAIN_ADMIN,
    'dashboardAccess.status': 'active',
    'dashboardAccess.role': { $in: ['operations_admin', 'operation_admin'] },
  })
    .select('userId email name dashboardAccess')
    .lean();

  const activeRecipients = TASK_POSTED_ROUND_ROBIN_EMAILS.map((email) =>
    admins.find((admin) => normalizeAdminEmail(admin.email) === normalizeAdminEmail(email)),
  ).filter((admin) =>
    admin?.dashboardAccess?.some(
      (access) =>
        access.dashboardType === DashboardType.MAIN_ADMIN &&
        access.status === 'active' &&
        ['operations_admin', 'operation_admin'].includes(access.role),
    ),
  );

  if (activeRecipients.length === 0) {
    logger.warn('No active operations admins found for task_posted round-robin', {
      expectedEmails: TASK_POSTED_ROUND_ROBIN_EMAILS,
      foundAdminEmails: admins.map((admin) => admin.email),
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
  if (!selected) return null;

  const email = normalizeAdminEmail(selected.email);
  return {
    userId: selected.userId,
    email,
    name: resolveAssignedDisplayName(email, selected.name),
  };
}
