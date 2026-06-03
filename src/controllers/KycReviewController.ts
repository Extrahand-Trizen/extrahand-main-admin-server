import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env';
import logger from '../config/logger';
import { AdminNotification } from '../models/AdminNotification';
import { AdminUser } from '../models/AdminUser';
import { KycFollowUpStatus, KycReview, KycReviewStatus } from '../models/KycReview';
import { KycSession } from '../models/KycSession';
import { DashboardType } from '../types/dashboard';
import { userServiceClient } from '../services/UserServiceClient';
import { minioService } from '../services/MinioService';

const AADHAAR_NOTIFICATION_TYPES = [
  'aadhaar_verification_failed',
  'aadhaar_verification_under_review',
];

const REVIEW_STATUSES: KycReviewStatus[] = ['pending', 'accepted', 'rejected'];
const FOLLOW_UP_STATUSES: KycFollowUpStatus[] = [
  'none',
  'follow_up',
  'not_interested',
  'followup_uploaded',
];

function isOperationsRole(role?: string): boolean {
  return ['operations_admin', 'operation_admin', 'operations'].includes(role || '');
}

function isAllReviewsRole(req: Request): boolean {
  return Boolean(req.admin?.isSuperAdmin || req.admin?.role === 'platform_admin');
}

function hasKycReviewAccess(req: Request): boolean {
  return Boolean(isAllReviewsRole(req) || isOperationsRole(req.admin?.role));
}

function requireKycReviewAccess(req: Request, res: Response): boolean {
  if (!req.admin) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return false;
  }
  if (!hasKycReviewAccess(req)) {
    res.status(403).json({ success: false, error: 'KYC review access required' });
    return false;
  }
  return true;
}

function actor(req: Request) {
  return {
    userId: req.admin!.userId,
    email: req.admin!.email,
    name: req.admin!.name,
  };
}

function notificationQuery(req: Request): Record<string, any> {
  const query: Record<string, any> = {
    dashboardType: DashboardType.MAIN_ADMIN,
    type: { $in: AADHAAR_NOTIFICATION_TYPES },
  };

  if (!isAllReviewsRole(req)) {
    query.targetAdminUserIds = req.admin?.userId;
  }

  return query;
}

function isAcceptedFilter(value: string): boolean {
  return ['accepted', 'accept'].includes(value);
}

function isRejectedFilter(value: string): boolean {
  return ['rejected', 'reject'].includes(value);
}

function normalizeReviewStatus(value: unknown): KycReviewStatus | null {
  const status = String(value || '').trim().toLowerCase();
  if (REVIEW_STATUSES.includes(status as KycReviewStatus)) return status as KycReviewStatus;
  return null;
}

function normalizeFollowUpStatus(value: unknown): KycFollowUpStatus | null {
  const status = String(value || '').trim().toLowerCase();
  if (FOLLOW_UP_STATUSES.includes(status as KycFollowUpStatus)) return status as KycFollowUpStatus;
  return null;
}

function getAadhaarStatus(user: any, notification: any): string {
  return String(
    user?.aadhaarKyc?.visibleStatus ||
      user?.aadhaarKyc?.internalStatus ||
      user?.aadhaarKyc?.status ||
      notification?.metadata?.status ||
      '',
  );
}

/**
 * Fetch Aadhaar image presigned URLs from the KYC vault via MinIO.
 *
 * Lookup strategy (in priority order):
 *  1. KycSession by verification_id (the `eh_abc123...` string from user.aadhaarKyc.verificationId)
 *  2. KycSession by userId + sessionType fallback (when verificationId is missing)
 *  3. Legacy documents / imageUrls already stored on the user profile
 *
 * NOTE: user.aadhaarKyc.id  = MongoDB _id  (do NOT use for verification_id query)
 *       user.aadhaarKyc.verificationId = verification_id (eh_...)  ← use this
 */
async function getAadhaarDocuments(
  user: any,
  verificationId: string,
  userId: string,
): Promise<Array<{ label: string; url: string }>> {
  if (minioService.isReady) {
    try {
      const sessionProjection = {
        'ocr.frontImageKey': 1,
        'ocr.backImageKey': 1,
      };
      const sessionSort = { updatedAt: -1, createdAt: -1 } as const;

      // Prefer exact verification_id match, then fall back to latest OCR session for user.
      let session = verificationId
        ? await KycSession.findOne({ verification_id: verificationId }, sessionProjection)
            .sort(sessionSort)
            .lean()
        : null;

      if (!session?.ocr?.frontImageKey && !session?.ocr?.backImageKey) {
        session = await KycSession.findOne(
          { userId, sessionType: 'aadhaar_ocr' },
          sessionProjection,
        )
          .sort(sessionSort)
          .lean();
      }

      if (session?.ocr) {
        const keysToSign: Array<{ key: string; label: string }> = [];
        if (session.ocr.frontImageKey) {
          keysToSign.push({ key: session.ocr.frontImageKey, label: 'Aadhaar front' });
        }
        if (session.ocr.backImageKey) {
          keysToSign.push({ key: session.ocr.backImageKey, label: 'Aadhaar back' });
        }
        if (keysToSign.length > 0) {
          const docs = await minioService.getPresignedUrls(keysToSign);
          if (docs.length > 0) return docs;
          logger.warn('KycReviewController: KycSession had image keys but presigning returned none', {
            verificationId,
            userId,
            keys: keysToSign.map((item) => item.key),
          });
        }
      } else {
        logger.debug('KycReviewController: no KycSession OCR image keys found', {
          verificationId,
          userId,
        });
      }
    } catch (error: any) {
      logger.warn('KycReviewController: failed to fetch KycSession image keys', {
        verificationId,
        userId,
        error: error.message,
      });
    }
  }

  // --- Fallback: legacy documents / imageUrls stored on user profile ---
  const rawDocuments = user?.aadhaarKyc?.documents;
  if (Array.isArray(rawDocuments) && rawDocuments.length > 0) {
    return rawDocuments
      .map((item: any, index: number) => ({
        label: String(item?.label || `Aadhaar image ${index + 1}`),
        url: String(item?.url || ''),
      }))
      .filter((item: { label: string; url: string }) => item.url);
  }

  const imageUrls = Array.isArray(user?.aadhaarKyc?.imageUrls) ? user.aadhaarKyc.imageUrls : [];
  return imageUrls
    .map((url: unknown, index: number) => ({
      label: `Aadhaar image ${index + 1}`,
      url: String(url || ''),
    }))
    .filter((item: { label: string; url: string }) => item.url);
}

async function getAssignedTo(targetAdminUserIds: string[] = []) {
  const ids = Array.from(new Set(targetAdminUserIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const admins = await AdminUser.find({ userId: { $in: ids } })
    .select('userId name email')
    .lean();
  const adminMap = new Map(admins.map((admin) => [admin.userId, admin]));
  return ids.map((userId) => {
    const admin = adminMap.get(userId);
    return {
      userId,
      name: admin?.name || userId,
      email: admin?.email || '',
    };
  });
}

async function buildReviewRows(req: Request) {
  const notifications = await AdminNotification.find(notificationQuery(req))
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  const latestByUserId = new Map<string, any>();
  for (const notification of notifications) {
    const userId = String(notification.metadata?.userId || '').trim();
    if (!userId || latestByUserId.has(userId)) continue;
    latestByUserId.set(userId, notification);
  }

  const userIds = Array.from(latestByUserId.keys());
  const reviewDocs = await KycReview.find({ userId: { $in: userIds } }).lean();
  const reviewMap = new Map(
    reviewDocs.map((review) => [
      `${review.userId}:${review.sessionId || ''}`,
      review,
    ]),
  );
  const fallbackReviewMap = new Map(reviewDocs.map((review) => [review.userId, review]));

  const rows = [];
  for (const userId of userIds) {
    const notification = latestByUserId.get(userId);
    let user: any = null;
    try {
      const result = await userServiceClient.getUser(userId, req.admin!.userId);
      user = result?.data || result;
    } catch (error: any) {
      logger.warn('KYC review user enrichment failed', {
        userId,
        error: error.message,
      });
    }

    // aadhaarKyc.verificationId = the `verification_id` (eh_...) string stored in KycSession.
    // aadhaarKyc.id             = MongoDB _id — do NOT use for KycSession lookup.
    const verificationId = String(
      user?.aadhaarKyc?.verificationId ||
      notification.metadata?.verificationId ||
      notification.metadata?.sessionId ||
      '',
    );
    // sessionId is used for KycReview record keying (can be verificationId or a legacy id)
    const sessionId = verificationId || String(user?.aadhaarKyc?.id || '');
    const exactReview = reviewMap.get(`${userId}:${sessionId}`) || null;
    const previousReview = fallbackReviewMap.get(userId) || null;
    const review = exactReview || previousReview || null;
    const hasNewUploadAfterReview =
      !exactReview && Boolean(sessionId) && Boolean(previousReview?.sessionId);
    const assignedTo = await getAssignedTo(notification.targetAdminUserIds || []);

    // Resolve presigned Aadhaar image URLs from the KYC vault using the correct verificationId
    const documents = await getAadhaarDocuments(user, verificationId, userId);

    rows.push({
      notificationId: String(notification._id),
      userId,
      userName: user?.name || notification.metadata?.userName || 'Unknown user',
      userEmail: user?.email || notification.metadata?.userEmail || '',
      userPhone: user?.phone || notification.metadata?.userPhone || '',
      aadhaar: getAadhaarStatus(user, notification) || 'Under Review',
      failureReason:
        user?.aadhaarKyc?.failureReason ||
        notification.metadata?.failureReason ||
        review?.rejectionReason ||
        '',
      failedOn:
        user?.aadhaarKyc?.visibleFailureAt ||
        user?.aadhaarKyc?.updatedAt ||
        notification.createdAt,
      aadhaarUpdatedAt: user?.aadhaarKyc?.updatedAt || notification.createdAt,
      followUpStatus: hasNewUploadAfterReview ? 'followup_uploaded' : review?.followUpStatus || 'none',
      followUpDate: review?.followUpDate || null,
      assignedTo,
      reviewStatus: hasNewUploadAfterReview ? 'pending' : review?.reviewStatus || 'pending',
      reviewedBy: review?.reviewedBy || null,
      reviewedAt: review?.reviewedAt || null,
      sessionId,
      verificationId: user?.aadhaarKyc?.verificationId || notification.metadata?.verificationId || '',
      documents,
      profileUrl: `/users/${encodeURIComponent(userId)}?tab=verification`,
    });
  }

  return rows;
}

export class KycReviewController {
  static async list(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;

    try {
      const search = String(req.query.search || '').trim().toLowerCase();
      const reviewStatus = String(req.query.reviewStatus || 'all').trim().toLowerCase();
      const followUpStatus = String(req.query.followUpStatus || 'all').trim().toLowerCase();

      let rows = await buildReviewRows(req);

      if (reviewStatus !== 'all') {
        if (isAcceptedFilter(reviewStatus)) {
          rows = rows.filter((row) => row.reviewStatus === 'accepted');
        } else if (isRejectedFilter(reviewStatus)) {
          rows = rows.filter((row) => row.reviewStatus === 'rejected');
        } else {
          rows = rows.filter((row) => row.reviewStatus === reviewStatus);
        }
      }

      if (followUpStatus !== 'all') {
        rows = rows.filter((row) => row.followUpStatus === followUpStatus);
      }

      if (search) {
        rows = rows.filter((row) =>
          [
            row.userName,
            row.userEmail,
            row.userPhone,
            row.userId,
            row.aadhaar,
            row.failureReason,
            row.assignedTo.map((item) => `${item.name} ${item.email}`).join(' '),
          ]
            .join(' ')
            .toLowerCase()
            .includes(search),
        );
      }

      res.json({
        success: true,
        data: rows,
        pagination: {
          page: 1,
          limit: rows.length,
          total: rows.length,
          pages: 1,
        },
      });
    } catch (error: any) {
      logger.error('List KYC reviews error:', error);
      res.status(500).json({ success: false, error: 'Failed to list KYC reviews' });
    }
  }

  static async accept(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;

    try {
      const { userId } = req.params;
      const { sessionId, verificationId } = req.body || {};

      await userServiceClient.updateAadhaarVerification(
        userId,
        {
          isAadhaarVerified: true,
          aadhaarVerifiedAt: new Date().toISOString(),
          status: 'verified',
          internalStatus: 'verified',
          visibleStatus: 'Verified',
        },
        req.admin!.userId,
      );

      const review = await KycReview.findOneAndUpdate(
        { userId, sessionId: sessionId || '' },
        {
          $set: {
            userId,
            sessionId: sessionId || '',
            verificationId: verificationId || '',
            reviewStatus: 'accepted',
            followUpStatus: 'none',
            followUpDate: null,
            rejectionReason: '',
            reviewedBy: actor(req),
            reviewedAt: new Date(),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();

      res.json({ success: true, data: review });
    } catch (error: any) {
      logger.error('Accept KYC review error:', error);
      res.status(500).json({ success: false, error: 'Failed to accept Aadhaar review' });
    }
  }

  static async reject(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;

    try {
      const { userId } = req.params;
      const { sessionId, verificationId, reason } = req.body || {};
      const followUpStatus = normalizeFollowUpStatus(req.body?.followUpStatus) || 'follow_up';
      const followUpDate = req.body?.followUpDate ? new Date(req.body.followUpDate) : null;

      if (followUpStatus === 'follow_up' && (!followUpDate || Number.isNaN(followUpDate.getTime()))) {
        res.status(400).json({ success: false, error: 'Follow-up date is required' });
        return;
      }

      const review = await KycReview.findOneAndUpdate(
        { userId, sessionId: sessionId || '' },
        {
          $set: {
            userId,
            sessionId: sessionId || '',
            verificationId: verificationId || '',
            reviewStatus: 'rejected',
            followUpStatus,
            followUpDate: followUpStatus === 'follow_up' ? followUpDate : null,
            rejectionReason: String(reason || '').trim(),
            reviewedBy: actor(req),
            reviewedAt: new Date(),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();

      res.json({ success: true, data: review });
    } catch (error: any) {
      logger.error('Reject KYC review error:', error);
      res.status(500).json({ success: false, error: 'Failed to reject Aadhaar review' });
    }
  }

  static async updateFollowUp(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;

    try {
      const { userId } = req.params;
      const followUpStatus = normalizeFollowUpStatus(req.body?.followUpStatus);
      if (!followUpStatus || followUpStatus === 'none') {
        res.status(400).json({ success: false, error: 'Valid follow-up status is required' });
        return;
      }

      const followUpDate = req.body?.followUpDate ? new Date(req.body.followUpDate) : null;
      if (followUpStatus === 'follow_up' && (!followUpDate || Number.isNaN(followUpDate.getTime()))) {
        res.status(400).json({ success: false, error: 'Follow-up date is required' });
        return;
      }

      const reviewStatus = normalizeReviewStatus(req.body?.reviewStatus) || 'rejected';
      const review = await KycReview.findOneAndUpdate(
        { userId, sessionId: req.body?.sessionId || '' },
        {
          $set: {
            userId,
            sessionId: req.body?.sessionId || '',
            verificationId: req.body?.verificationId || '',
            reviewStatus,
            followUpStatus,
            followUpDate: followUpStatus === 'follow_up' ? followUpDate : null,
            reviewedBy: actor(req),
            reviewedAt: new Date(),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();

      res.json({ success: true, data: review });
    } catch (error: any) {
      logger.error('Update KYC follow-up error:', error);
      res.status(500).json({ success: false, error: 'Failed to update follow-up status' });
    }
  }
}
