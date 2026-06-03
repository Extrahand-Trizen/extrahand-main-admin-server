import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env';
import logger from '../config/logger';
import { AdminNotification } from '../models/AdminNotification';
import { KycFollowUpStatus, KycReview, KycReviewStatus } from '../models/KycReview';
import { KycSession } from '../models/KycSession';
import { DashboardType } from '../types/dashboard';
import { userServiceClient } from '../services/UserServiceClient';
import { minioService } from '../services/MinioService';
import { ensureKycAssigneeForUser } from '../services/AadhaarKycRecipientService';

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
  return {
    dashboardType: DashboardType.MAIN_ADMIN,
    type: { $in: AADHAAR_NOTIFICATION_TYPES },
  };
}

function resolveProfileUid(user: any, fallbackUserId: string): string {
  return String(user?.uid || user?.userId || fallbackUserId).trim();
}

function isProfileAadhaarVerified(user: any): boolean {
  if (!user) return false;
  if (user.isAadhaarVerified === true) return true;
  const status = String(
    user?.aadhaarKyc?.visibleStatus ||
      user?.aadhaarKyc?.internalStatus ||
      user?.aadhaarKyc?.status ||
      '',
  ).toLowerCase();
  return status === 'verified';
}

async function syncKycSessionVerified(userId: string, verificationId?: string): Promise<void> {
  const query: Record<string, unknown> = verificationId
    ? { verification_id: verificationId }
    : { userId, sessionType: 'aadhaar_ocr' };

  await KycSession.findOneAndUpdate(
    query,
    {
      $set: {
        visibleStatus: 'verified',
        internalStatus: 'completed',
        status: 'completed',
      },
    },
    { sort: { updatedAt: -1 } },
  );
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

function buildVaultSessionPrefix(userId: string, verificationId: string): string {
  const safeUser = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
  const safeSession = String(verificationId).replace(/[^a-zA-Z0-9_-]/g, '');
  return `aadhaar-ocr/${safeUser}/${safeSession}/`;
}

function labelForVaultKey(key: string): string {
  const fileName = key.split('/').pop() || key;
  if (fileName.startsWith('back_')) return 'Aadhaar back';
  if (fileName.startsWith('front_')) return 'Aadhaar front';
  return 'Aadhaar image';
}

function pickLatestVaultSideKeys(
  objects: Array<{ key: string; lastModified?: Date }>,
): Array<{ key: string; label: string }> {
  let front: { key: string; label: string; ts: number } | null = null;
  let back: { key: string; label: string; ts: number } | null = null;

  for (const object of objects) {
    const fileName = object.key.split('/').pop() || object.key;
    const ts = object.lastModified?.getTime() || 0;
    const entry = { key: object.key, label: labelForVaultKey(object.key), ts };

    if (fileName.startsWith('front_')) {
      if (!front || ts > front.ts) front = entry;
      continue;
    }
    if (fileName.startsWith('back_')) {
      if (!back || ts > back.ts) back = entry;
    }
  }

  const picked: Array<{ key: string; label: string }> = [];
  if (front) picked.push({ key: front.key, label: front.label });
  if (back) picked.push({ key: back.key, label: back.label });
  return picked;
}

async function getVaultKeysForSession(
  userId: string,
  verificationId: string,
  sessionOcr?: { frontImageKey?: string; backImageKey?: string },
): Promise<Array<{ key: string; label: string }>> {
  const merged = new Map<string, { key: string; label: string }>();

  if (sessionOcr?.frontImageKey) {
    merged.set(sessionOcr.frontImageKey, {
      key: sessionOcr.frontImageKey,
      label: 'Aadhaar front',
    });
  }
  if (sessionOcr?.backImageKey) {
    merged.set(sessionOcr.backImageKey, {
      key: sessionOcr.backImageKey,
      label: 'Aadhaar back',
    });
  }

  if (verificationId && userId) {
    const prefix = buildVaultSessionPrefix(userId, verificationId);
    const objects = await minioService.listObjectKeys(prefix);
    for (const item of pickLatestVaultSideKeys(objects)) {
      merged.set(item.key, item);
    }
  }

  const ordered: Array<{ key: string; label: string }> = [];
  for (const item of merged.values()) {
    if (item.label === 'Aadhaar front') ordered.unshift(item);
    else if (item.label === 'Aadhaar back') ordered.push(item);
    else ordered.push(item);
  }

  return ordered.sort((a, b) => {
    const rank = (label: string) =>
      label === 'Aadhaar front' ? 0 : label === 'Aadhaar back' ? 1 : 2;
    return rank(a.label) - rank(b.label);
  });
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

      if (session?.ocr || verificationId) {
        const keysToSign = await getVaultKeysForSession(
          userId,
          verificationId,
          session?.ocr,
        );
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

    const assignee = await ensureKycAssigneeForUser(userId);
    if (!isAllReviewsRole(req)) {
      const myId = req.admin?.userId;
      if (!assignee || assignee.userId !== myId) {
        continue;
      }
    }

    const assignedTo = assignee
      ? [
          {
            userId: assignee.userId,
            name: assignee.name,
            email: assignee.email,
          },
        ]
      : [];

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
      isAadhaarVerified: isProfileAadhaarVerified(user),
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

      let user: any = null;
      try {
        const result = await userServiceClient.getUser(userId, req.admin!.userId);
        user = result?.data || result;
      } catch (error: any) {
        logger.warn('Accept KYC review: user lookup failed', { userId, error: error.message });
      }

      const profileUid = resolveProfileUid(user, userId);

      if (isProfileAadhaarVerified(user)) {
        res.status(400).json({
          success: false,
          error: 'Aadhaar is already verified for this user',
        });
        return;
      }

      let maskedAadhaar =
        user?.maskedAadhaar ||
        (typeof user?.aadhaarKyc?.maskedAadhaar === 'string' ? user.aadhaarKyc.maskedAadhaar : undefined);

      if (!maskedAadhaar && verificationId) {
        const session = await KycSession.findOne(
          { verification_id: verificationId },
          { 'ocr.maskedAadhaar': 1 },
        ).lean();
        maskedAadhaar = session?.ocr?.maskedAadhaar;
      }

      const verifiedAt = new Date().toISOString();
      await userServiceClient.updateAadhaarVerification(
        profileUid,
        {
          isAadhaarVerified: true,
          aadhaarVerifiedAt: verifiedAt,
          ...(maskedAadhaar ? { maskedAadhaar } : {}),
          status: 'verified',
          internalStatus: 'verified',
          visibleStatus: 'Verified',
        },
        req.admin!.userId,
      );

      await syncKycSessionVerified(profileUid, verificationId || sessionId || undefined);

      const review = await KycReview.findOneAndUpdate(
        { userId: profileUid, sessionId: sessionId || '' },
        {
          $set: {
            userId: profileUid,
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

      res.json({
        success: true,
        data: {
          ...review,
          isAadhaarVerified: true,
          aadhaarVerifiedAt: verifiedAt,
        },
      });
    } catch (error: any) {
      logger.error('Accept KYC review error:', error);
      res.status(500).json({
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to accept Aadhaar review',
      });
    }
  }

  static async reject(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;

    try {
      const { userId } = req.params;
      const { sessionId, verificationId, reason } = req.body || {};
      const followUpStatus = normalizeFollowUpStatus(req.body?.followUpStatus) || 'follow_up';
      const followUpDate = req.body?.followUpDate ? new Date(req.body.followUpDate) : null;

      let user: any = null;
      try {
        const result = await userServiceClient.getUser(userId, req.admin!.userId);
        user = result?.data || result;
      } catch (error: any) {
        logger.warn('Reject KYC review: user lookup failed', { userId, error: error.message });
      }

      if (isProfileAadhaarVerified(user)) {
        res.status(400).json({
          success: false,
          error: 'Cannot reject: Aadhaar is already verified for this user',
        });
        return;
      }

      const profileUid = resolveProfileUid(user, userId);

      if (followUpStatus === 'follow_up' && (!followUpDate || Number.isNaN(followUpDate.getTime()))) {
        res.status(400).json({ success: false, error: 'Follow-up date is required' });
        return;
      }

      const review = await KycReview.findOneAndUpdate(
        { userId: profileUid, sessionId: sessionId || '' },
        {
          $set: {
            userId: profileUid,
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
