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
const AADHAAR_NOTIFICATION_TYPES = [
  'aadhaar_verification_failed',
  'aadhaar_verification_under_review',
];

export function visibleNotificationsQuery(
  dashboardType: DashboardType,
  userId: string,
  email?: string,
): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [
    {
      type: {
        $nin: ['task_posted', ...AADHAAR_NOTIFICATION_TYPES],
      },
      $or: [
        { targetAdminUserIds: { $exists: false } },
        { targetAdminUserIds: { $size: 0 } },
        { targetAdminUserIds: userId },
      ],
    },
    {
      type: { $in: AADHAAR_NOTIFICATION_TYPES },
      targetAdminUserIds: userId,
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
