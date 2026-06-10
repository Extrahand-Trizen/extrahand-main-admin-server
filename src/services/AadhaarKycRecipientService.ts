import logger from '../config/logger';
import { AdminNotification } from '../models/AdminNotification';
import { AdminUser } from '../models/AdminUser';
import { AadhaarKycAssignment } from '../models/AadhaarKycAssignment';
import { NotificationSequence } from '../models/NotificationSequence';
import { DashboardType } from '../types/dashboard';
import {
  TASK_POSTED_ROUND_ROBIN_EMAILS,
  normalizeAdminEmail,
  resolveAssignedDisplayName,
} from '../constants/taskAssignment';

export type AadhaarKycRecipient = {
  userId: string;
  email: string;
  name: string;
};

const OPS_DASHBOARD_ROLES = ['operations_admin', 'operation_admin', 'operations'];
const ROUND_ROBIN_SEQUENCE_KEY = 'aadhaar_kyc_operations_round_robin';

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

export async function listAadhaarKycRecipients(): Promise<AadhaarKycRecipient[]> {
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
  }).filter((row): row is AadhaarKycRecipient => Boolean(row));
}

export async function getNextAadhaarKycRecipient(): Promise<AadhaarKycRecipient | null> {
  const activeRecipients = await listAadhaarKycRecipients();
  if (activeRecipients.length === 0) {
    logger.error('No active operations admins found for Aadhaar KYC round-robin', {
      expectedEmails: TASK_POSTED_ROUND_ROBIN_EMAILS,
    });
    return null;
  }

  const sequence = await NotificationSequence.findOneAndUpdate(
    { key: ROUND_ROBIN_SEQUENCE_KEY },
    { $inc: { value: 1 } },
    { new: false, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  const currentValue = sequence?.value || 0;
  return activeRecipients[currentValue % activeRecipients.length] || null;
}

/**
 * Sticky assignee for a KYC user: re-uploads go back to the same ops admin.
 */
export async function resolveAadhaarKycRecipient(
  kycUserId: string,
): Promise<AadhaarKycRecipient | null> {
  const trimmedUserId = String(kycUserId || '').trim();
  if (!trimmedUserId) return null;

  const existing = await AadhaarKycAssignment.findOne({ userId: trimmedUserId }).lean();
  if (existing?.assignedToUserId) {
    const recipients = await listAadhaarKycRecipients();
    const sticky = recipients.find((row) => row.userId === existing.assignedToUserId);
    if (sticky) return sticky;

    return {
      userId: existing.assignedToUserId,
      email: normalizeAdminEmail(existing.assignedToEmail),
      name: existing.assignedToName || existing.assignedToEmail,
    };
  }

  return getNextAadhaarKycRecipient();
}

export async function persistAadhaarKycAssignment(input: {
  userId: string;
  recipient: AadhaarKycRecipient;
  notificationId?: string;
}): Promise<void> {
  const userId = String(input.userId || '').trim();
  if (!userId) return;

  await AadhaarKycAssignment.findOneAndUpdate(
    { userId },
    {
      userId,
      assignedToUserId: input.recipient.userId,
      assignedToEmail: input.recipient.email,
      assignedToName: input.recipient.name,
      lastNotificationId: input.notificationId,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export function buildKycReviewLinkUrl(userId: string): string {
  return `/kyc-reviews?userId=${encodeURIComponent(userId)}`;
}

export type KycAssigneeInfo = {
  userId: string;
  email: string;
  name: string;
};

/** Repair legacy notifications that targeted all ops admins at once. */
export async function repairLegacyAadhaarNotificationsForUser(
  kycUserId: string,
  recipient: AadhaarKycRecipient,
): Promise<void> {
  const userId = String(kycUserId || '').trim();
  if (!userId) return;

  await AdminNotification.updateMany(
    {
      dashboardType: DashboardType.MAIN_ADMIN,
      type: { $in: ['aadhaar_verification_failed', 'aadhaar_verification_under_review'] },
      'metadata.userId': userId,
    },
    {
      $set: {
        targetAdminUserIds: [recipient.userId],
        linkUrl: buildKycReviewLinkUrl(userId),
        'metadata.assignedToUserId': recipient.userId,
        'metadata.assignedToEmail': recipient.email,
        'metadata.assignedToName': recipient.name,
      },
    },
  );
}

/**
 * Source of truth for who is assigned to a KYC user (sticky + round-robin backfill).
 */
export async function ensureKycAssigneeForUser(
  kycUserId: string,
): Promise<KycAssigneeInfo | null> {
  const userId = String(kycUserId || '').trim();
  if (!userId) return null;

  const existing = await AadhaarKycAssignment.findOne({ userId }).lean();
  if (existing?.assignedToUserId) {
    const recipient: AadhaarKycRecipient = {
      userId: existing.assignedToUserId,
      email: normalizeAdminEmail(existing.assignedToEmail),
      name: existing.assignedToName || existing.assignedToEmail,
    };
    await repairLegacyAadhaarNotificationsForUser(userId, recipient);
    return recipient;
  }

  const recipient = await resolveAadhaarKycRecipient(userId);
  if (!recipient) return null;

  await persistAadhaarKycAssignment({ userId, recipient });
  await repairLegacyAadhaarNotificationsForUser(userId, recipient);
  return recipient;
}

export async function listAllAadhaarKycAdmins(): Promise<AadhaarKycRecipient[]> {
  const admins = await AdminUser.find({
    status: 'active',
  })
    .select('userId email name dashboardAccess')
    .lean();

  const results: AadhaarKycRecipient[] = [];
  for (const admin of admins) {
    if (hasActiveMainAdminOpsAccess(admin)) {
      results.push({
        userId: admin.userId,
        email: normalizeAdminEmail(admin.email),
        name: resolveAssignedDisplayName(normalizeAdminEmail(admin.email), admin.name),
      });
    }
  }
  return results;
}
