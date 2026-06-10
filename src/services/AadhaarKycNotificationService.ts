import logger from '../config/logger';
import { AdminNotification } from '../models/AdminNotification';
import { DashboardType } from '../types/dashboard';
import {
  buildKycReviewLinkUrl,
  listAllAadhaarKycAdmins,
} from './AadhaarKycRecipientService';

export type AadhaarKycNotificationPayload = {
  type: 'aadhaar_verification_failed' | 'aadhaar_verification_under_review';
  userId?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  status?: string;
  failureReason?: string;
  verificationId?: string;
  sessionId?: string;
  occurredAt?: string;
};

function buildAadhaarNotificationContent(payload: AadhaarKycNotificationPayload) {
  if (payload.type === 'aadhaar_verification_failed') {
    return {
      title: 'Aadhaar verification failed',
      message: payload.userName
        ? `${payload.userName}'s Aadhaar verification failed${
            payload.failureReason ? `: ${payload.failureReason}` : '.'
          }`
        : 'Aadhaar verification failed for a user.',
    };
  }

  return {
    title: 'Aadhaar verification under review',
    message: payload.userName
      ? `${payload.userName}'s Aadhaar verification is under review.`
      : 'Aadhaar verification is under review for a user.',
  };
}

export async function createAadhaarKycAdminNotification(
  payload: AadhaarKycNotificationPayload,
): Promise<{
  created: boolean;
  targetAdminUserIds: string[];
  notificationId?: string;
}> {
  const userId = String(payload.userId || '').trim();
  if (!userId) {
    return { created: false, targetAdminUserIds: [] };
  }

  const admins = await listAllAadhaarKycAdmins();
  const targetAdminUserIds = admins.map((a) => a.userId);

  if (targetAdminUserIds.length === 0) {
    logger.warn('No Aadhaar KYC ops admins found for notification broadcast', {
      userId,
      type: payload.type,
    });
  }

  const content = buildAadhaarNotificationContent(payload);
  const linkUrl = buildKycReviewLinkUrl(userId);
  const metadata = {
    userId,
    userName: payload.userName,
    userEmail: payload.userEmail,
    userPhone: payload.userPhone,
    status: payload.status,
    failureReason: payload.failureReason,
    verificationId: payload.verificationId,
    sessionId: payload.sessionId,
    occurredAt: payload.occurredAt || new Date().toISOString(),
  };

  const recentCutoff = new Date(Date.now() - 10 * 60 * 1000);
  const recent = await AdminNotification.findOne({
    type: payload.type,
    dashboardType: DashboardType.MAIN_ADMIN,
    'metadata.userId': userId,
    createdAt: { $gte: recentCutoff },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (recent) {
    await AdminNotification.updateOne(
      { _id: recent._id },
      {
        $set: {
          title: content.title,
          message: content.message,
          linkUrl,
          targetAdminUserIds,
          metadata,
        },
      },
    );
    return {
      created: true,
      targetAdminUserIds,
      notificationId: String(recent._id),
    };
  }

  const createdNotification = await AdminNotification.create({
    type: payload.type,
    title: content.title,
    message: content.message,
    linkUrl,
    dashboardType: DashboardType.MAIN_ADMIN,
    targetAdminUserIds,
    metadata,
  });

  const notificationId = String(createdNotification._id);

  logger.info('Aadhaar KYC notification broadcasted to all ops admins', {
    notificationId,
    userId,
    type: payload.type,
    targetAdminUserIds,
  });

  return {
    created: true,
    targetAdminUserIds,
    notificationId,
  };
}
