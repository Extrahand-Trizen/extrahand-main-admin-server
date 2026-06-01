import { DashboardType } from '../types/dashboard';
import {
  TASK_ASSIGNED_EMAILS,
  normalizeAdminEmail,
} from '../constants/taskAssignment';

export function isTaskPostedCyclicRecipient(email?: string): boolean {
  return TASK_ASSIGNED_EMAILS.includes(normalizeAdminEmail(email));
}

/**
 * In-app notification visibility.
 * task_posted: only the single assigned ops admin (one of the 3 cyclic recipients).
 * Other types: existing targeted / broadcast rules.
 */
export function visibleNotificationsQuery(
  dashboardType: DashboardType,
  userId: string,
  email?: string,
): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [
    {
      type: { $ne: 'task_posted' },
      $or: [
        { targetAdminUserIds: { $exists: false } },
        { targetAdminUserIds: { $size: 0 } },
        { targetAdminUserIds: userId },
      ],
    },
  ];

  if (isTaskPostedCyclicRecipient(email)) {
    conditions.push({
      type: 'task_posted',
      targetAdminUserIds: userId,
    });
  }

  return {
    dashboardType,
    $or: conditions,
  };
}
