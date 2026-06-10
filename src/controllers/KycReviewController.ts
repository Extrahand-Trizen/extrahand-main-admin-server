import { Request, Response } from 'express';
import { env } from '../config/env';
import logger from '../config/logger';
import { AdminNotification } from '../models/AdminNotification';


import { KycFollowUpStatus, KycReview, KycReviewStatus } from '../models/KycReview';
import { KycSession } from '../models/KycSession';
import { DashboardType } from '../types/dashboard';
import { userServiceClient } from '../services/UserServiceClient';
import { minioService } from '../services/MinioService';
import { ensureKycAssigneeForUser } from '../services/AadhaarKycRecipientService';
import { createAadhaarKycAdminNotification } from '../services/AadhaarKycNotificationService';

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
  /** Admin-upload session ID (admin_upload_...) — searched as a separate MinIO prefix */
  adminSessionId?: string,
): Promise<Array<{ label: string; url: string }>> {
  if (minioService.isReady) {
    try {
      const sessionProjection = {
        'ocr.frontImageKey': 1,
        'ocr.backImageKey': 1,
      };
      const sessionSort = { updatedAt: -1, createdAt: -1 } as const;

      // 1. If this is an admin-upload session, search that MinIO prefix first.
      //    Admin uploads store objects under aadhaar-ocr/{userId}/{adminSessionId}/
      //    and never create a KycSession record, so skip the DB lookup entirely.
      if (adminSessionId && adminSessionId.startsWith('admin_upload_')) {
        const adminKeys = await getVaultKeysForSession(userId, adminSessionId, undefined);
        if (adminKeys.length > 0) {
          const adminDocs = await minioService.getPresignedUrls(adminKeys);
          if (adminDocs.length > 0) {
            logger.debug('KycReviewController: served admin-upload images from vault', {
              adminSessionId,
              userId,
              count: adminDocs.length,
            });
            return adminDocs;
          }
        }
        logger.warn('KycReviewController: admin-upload session had no vault images', {
          adminSessionId,
          userId,
        });
      }

      // 2. Prefer exact verification_id match (DigiLocker / OCR sessions), then fall
      //    back to the latest OCR session for the user.
      let session = verificationId && !verificationId.startsWith('admin_upload_')
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

      if (session?.ocr || (verificationId && !verificationId.startsWith('admin_upload_'))) {
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
  // Notification-driven approach: only show users who have triggered an Aadhaar
  // KYC review event (aadhaar_verification_failed or aadhaar_verification_under_review).
  // This matches the production behavior (16 real reviews) vs the all-unverified-helpers
  // approach that showed 20 including non-KYC-event users.
  const notifications = await AdminNotification.find({
    dashboardType: DashboardType.MAIN_ADMIN,
    type: { $in: AADHAAR_NOTIFICATION_TYPES },
  })
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

  // Resolve all user profiles and UIDs to avoid mismatches
  const resolvedUserMap = new Map<string, { user: any; profileUid: string }>();
  const allLookupIds = new Set<string>();

  for (const userId of userIds) {
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
    const profileUid = resolveProfileUid(user, userId);
    resolvedUserMap.set(userId, { user, profileUid });
    allLookupIds.add(userId);
    allLookupIds.add(profileUid);
  }

  const reviewDocs = await KycReview.find({ userId: { $in: Array.from(allLookupIds) } }).lean();
  const reviewMap = new Map<string, any>();
  for (const review of reviewDocs) {
    reviewMap.set(`${review.userId}:${review.sessionId || ''}`, review);
  }
  const fallbackReviewMap = new Map<string, any>();
  for (const review of reviewDocs) {
    fallbackReviewMap.set(review.userId, review);
  }

  const rows = [];
  for (const userId of userIds) {
    const notification = latestByUserId.get(userId);
    const resolved = resolvedUserMap.get(userId);
    const user = resolved?.user || null;
    const profileUid = resolved?.profileUid || userId;

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
    
    // Check both profileUid and unresolved userId keys in review maps
    const exactReview = reviewMap.get(`${profileUid}:${sessionId}`) || reviewMap.get(`${userId}:${sessionId}`) || null;
    const previousReview = fallbackReviewMap.get(profileUid) || fallbackReviewMap.get(userId) || null;
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

    // Detect manual admin-upload sessions (sessionId starts with "admin_upload_").
    // The review document holds the canonical admin sessionId even when verificationId
    // points to an older DigiLocker session, so we must use it for MinIO lookup.
    const isManualUpload = Boolean(sessionId && String(sessionId).startsWith('admin_upload_'));
    const uploadedBy = review?.uploadedBy || null;

    // Resolve the admin upload session ID from the review record if available.
    // This ensures we always look in the correct MinIO prefix for admin uploads,
    // even when the user also has a prior DigiLocker verificationId.
    const adminSessionId =
      (review?.sessionId && String(review.sessionId).startsWith('admin_upload_')
        ? review.sessionId
        : undefined) ||
      (notification?.metadata?.sessionId && String(notification.metadata.sessionId).startsWith('admin_upload_')
        ? notification.metadata.sessionId
        : undefined);

    // Resolve presigned Aadhaar image URLs from the KYC vault.
    // For admin uploads, adminSessionId takes priority over verificationId.
    const documents = await getAadhaarDocuments(user, verificationId, userId, adminSessionId);

    rows.push({
      notificationId: String(notification._id),
      userId,
      userName: user?.name || notification.metadata?.userName || 'Unknown user',
      userEmail: user?.email || notification.metadata?.userEmail || '',
      userPhone: user?.phone || notification.metadata?.userPhone || '',
      registeredAt: String(user?.createdAt || user?.created_at || notification.createdAt || ''),
      aadhaar: getAadhaarStatus(user, notification) || 'Under Review',
      failureReason:
        user?.aadhaarKyc?.failureReason ||
        notification.metadata?.failureReason ||
        review?.rejectionReason ||
        '',
      failedOn:
        user?.aadhaarKyc?.visibleFailureAt ||
        user?.aadhaarKyc?.updatedAt ||
        notification?.createdAt ||
        null,
      aadhaarUpdatedAt: user?.aadhaarKyc?.updatedAt || notification?.createdAt || null,
      followUpStatus: hasNewUploadAfterReview ? 'followup_uploaded' : review?.followUpStatus || 'none',
      followUpDate: review?.followUpDate || null,
      assignedTo,
      reviewStatus: hasNewUploadAfterReview ? 'pending' : review?.reviewStatus || 'pending',
      reviewedBy: review?.reviewedBy || null,
      reviewedAt: review?.reviewedAt || null,
      sessionId,
      verificationId: user?.aadhaarKyc?.verificationId || notification?.metadata?.verificationId || '',
      isAadhaarVerified: isProfileAadhaarVerified(user),
      isManualUpload,
      uploadedBy,
      uploadedAt: review?.uploadedAt || null,
      documents,
      profileUrl: `/users/${encodeURIComponent(userId)}?tab=verification`,
    });
  }

  return rows;
}

// ──────────────────────────────────────────────────────────────────────────────
// Admin-initiated Aadhaar document upload
// ──────────────────────────────────────────────────────────────────────────────

const ALLOWED_UPLOAD_SIDES = ['front', 'back'] as const;
type AadhaarSide = (typeof ALLOWED_UPLOAD_SIDES)[number];

function isValidSide(value: unknown): value is AadhaarSide {
  return ALLOWED_UPLOAD_SIDES.includes(value as AadhaarSide);
}

/**
 * Generate a fresh admin-upload session ID for this batch.
 * Format: admin_upload_{userId}_{timestamp}
 * Each new upload batch (front+back pair) gets its own folder so re-uploads
 * never mix old and new images. The KYC review panel always picks the latest
 * pair via pickLatestVaultSideKeys which sorts by lastModified descending.
 */
function newAdminUploadSessionId(userId: string): string {
  return `admin_upload_${userId}_${Date.now()}`;
}

/**
 * GET /api/v1/kyc-reviews/:userId/upload-status
 *
 * Returns whether admin-uploaded photos exist for this user and, if so,
 * the most recent session details.  Used by the UI to decide whether to show
 * "Upload photos" or "Re-upload photos".
 */

/**
 * POST /api/v1/kyc-reviews/:userId/upload-aadhaar
 *
 * Uploads a single Aadhaar photo (front or back) to the KYC vault on behalf
 * of a user.  The caller must pass `sessionId` in the form body so that both
 * front and back of the same batch land in the same folder.
 *
 * Flow:
 *   1. Frontend calls GET upload-status to get (or create) a sessionId.
 *   2. Front image uploaded with that sessionId.
 *   3. Back image uploaded with the same sessionId.
 *   4. After back-side upload, notification is sent and KycReview is upserted.
 *
 * On re-upload the frontend generates a brand-new sessionId (from the
 * newAdminUploadSessionId helper echoed in the upload-status response) so
 * the new batch lives in a different prefix and the review panel picks only
 * the latest pair.
 */

export class KycReviewController {
  /** Returns existing upload info so the UI can show "Re-upload" if photos exist. */
  static async getUploadStatus(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;

    try {
      const { userId } = req.params;

      // Find the most recent KycReview for this user that has an admin-upload sessionId
      const review = await KycReview.findOne({
        userId,
        sessionId: { $regex: /^admin_upload_/ },
      })
        .sort({ updatedAt: -1 })
        .lean();

      // Generate a fresh session ID that the frontend will use for the next upload batch.
      // This ensures re-uploads always land in a new folder.
      const nextSessionId = newAdminUploadSessionId(userId);

      if (!review) {
        res.json({
          success: true,
          data: {
            hasUpload: false,
            sessionId: null,
            uploadedAt: null,
            reviewStatus: null,
            nextSessionId,
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          hasUpload: true,
          sessionId: review.sessionId,
          uploadedAt: review.updatedAt,
          reviewStatus: review.reviewStatus,
          nextSessionId,
        },
      });
    } catch (error: any) {
      logger.error('getUploadStatus error:', error);
      res.status(500).json({ success: false, error: 'Failed to get upload status' });
    }
  }

  static async uploadAadhaarDocument(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;

    try {
      const { userId } = req.params;
      const side = String(req.body?.side || '').trim().toLowerCase();

      if (!isValidSide(side)) {
        res.status(400).json({ success: false, error: 'side must be "front" or "back"' });
        return;
      }

      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ success: false, error: 'Image file is required' });
        return;
      }

      // sessionId must be provided by the caller (from upload-status nextSessionId)
      // so front and back of the same batch share the same folder.
      const sessionId = String(req.body?.sessionId || '').trim();
      if (!sessionId) {
        res.status(400).json({ success: false, error: 'sessionId is required' });
        return;
      }

      if (!minioService.isReady) {
        res.status(503).json({
          success: false,
          error: 'Storage service not available. Please configure MinIO/S3.',
        });
        return;
      }

      // Fetch user profile for notification metadata
      let user: any = null;
      try {
        const result = await userServiceClient.getUser(userId, req.admin!.userId);
        user = result?.data || result;
      } catch (err: any) {
        logger.warn('uploadAadhaarDocument: user lookup failed', { userId, error: err.message });
      }

      const existingVerificationId = String(user?.aadhaarKyc?.verificationId || '').trim();

      // Build object key — side prefix ensures pickLatestVaultSideKeys can identify front/back
      const timestamp = Date.now();
      const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const objectKey = `aadhaar-ocr/${userId}/${sessionId}/${side}_${timestamp}.${ext}`;

      // ── Write directly to the KYC vault bucket ──────────────────────────────
      await minioService.uploadFile(objectKey, file.buffer, file.mimetype);

      logger.info('Admin uploaded Aadhaar document to KYC vault', {
        adminUserId: req.admin!.userId,
        userId,
        side,
        objectKey,
        bucket: 'extrahand-kyc-vault (via MinioService)',
      });

      // ── After back-side upload: notify + upsert KycReview ───────────────────
      if (side === 'back') {
        // Upsert KycReview with this sessionId (new batch = new record keyed by sessionId)
        try {
          await KycReview.findOneAndUpdate(
            { userId, sessionId },
            {
              $set: {
                userId,
                sessionId,
                verificationId: existingVerificationId || '',
                reviewStatus: 'pending',
                followUpStatus: 'none',
                followUpDate: null,
                rejectionReason: '',
                uploadedBy: {
                  userId: req.admin!.userId,
                  email: req.admin!.email,
                  name: req.admin!.name,
                },
                uploadedAt: new Date(),
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );
        } catch (reviewErr: any) {
          logger.warn('Failed to upsert KycReview after admin upload', {
            userId,
            error: reviewErr.message,
          });
        }

        // Send notification to operations admin (cyclic round-robin)
        try {
          const payload = {
            type: 'aadhaar_verification_under_review' as const,
            userId,
            userName: user?.name || undefined,
            userEmail: user?.email || undefined,
            userPhone: user?.phone || undefined,
            status: 'under_review',
            verificationId: sessionId,
            sessionId,
            occurredAt: new Date().toISOString(),
          };
          const notifResult = await createAadhaarKycAdminNotification(payload);
          logger.info('Aadhaar under_review notification sent after admin upload', {
            userId,
            notificationId: notifResult.notificationId,
            assignedTo: notifResult.assignedTo?.email,
          });
        } catch (notifErr: any) {
          logger.warn('Failed to send aadhaar_verification_under_review notification', {
            userId,
            error: notifErr.message,
          });
        }
      }

      res.json({
        success: true,
        data: {
          side,
          objectKey,
          sessionId,
          message:
            side === 'back'
              ? 'Both Aadhaar photos uploaded. Notification sent to operations admin.'
              : 'Front photo uploaded. Please upload the back side next.',
        },
      });
    } catch (error: any) {
      logger.error('uploadAadhaarDocument error:', error);
      res.status(500).json({ success: false, error: 'Failed to upload Aadhaar document' });
    }
  }

  static async list(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;

    try {
      const search = String(req.query.search || '').trim().toLowerCase();
      const reviewStatus = String(req.query.reviewStatus || 'all').trim().toLowerCase();
      const followUpStatus = String(req.query.followUpStatus || 'all').trim().toLowerCase();
      const includeVerified = String(req.query.includeVerified || 'false').trim().toLowerCase() === 'true';
      const assignedTo = String(req.query.assignedTo || 'all').trim();
      const sortOrder = String(req.query.sortOrder || 'newest').trim().toLowerCase();
      const page = Math.max(1, parseInt(String(req.query.page || '1')));
      const limit = Math.max(1, parseInt(String(req.query.limit || '20')));

      let rows = await buildReviewRows(req);

      if (reviewStatus !== 'all') {
        if (isAcceptedFilter(reviewStatus)) {
          rows = rows.filter((row) => row.reviewStatus === 'accepted' || row.isAadhaarVerified);
        } else if (isRejectedFilter(reviewStatus)) {
          rows = rows.filter((row) => row.reviewStatus === 'rejected');
        } else if (reviewStatus === 'pending') {
          rows = rows.filter(
            (row) =>
              !row.isAadhaarVerified &&
              row.reviewStatus !== 'accepted' &&
              row.reviewStatus !== 'rejected',
          );
        } else {
          rows = rows.filter((row) => row.reviewStatus === reviewStatus);
        }
      }

      if (!includeVerified) {
        rows = rows.filter((row) => !row.isAadhaarVerified);
      }

      if (followUpStatus !== 'all') {
        rows = rows.filter((row) => row.followUpStatus === followUpStatus);
      }

      if (assignedTo !== 'all') {
        rows = rows.filter((row) => row.assignedTo.some((admin) => admin.userId === assignedTo));
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

      // Sort
      rows.sort((a, b) => {
        const aTime = a.isManualUpload
          ? (a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0)
          : (a.failedOn ? new Date(a.failedOn).getTime() : 0);
        const bTime = b.isManualUpload
          ? (b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0)
          : (b.failedOn ? new Date(b.failedOn).getTime() : 0);

        const aDate = aTime || (a.registeredAt ? new Date(a.registeredAt).getTime() : 0);
        const bDate = bTime || (b.registeredAt ? new Date(b.registeredAt).getTime() : 0);

        if (sortOrder === 'oldest') return aDate - bDate;
        return bDate - aDate;
      });

      // Paginate
      const total = rows.length;
      const startIndex = (page - 1) * limit;
      const paginatedRows = rows.slice(startIndex, startIndex + limit);
      const pages = Math.ceil(total / limit);

      res.json({
        success: true,
        data: paginatedRows,
        pagination: {
          page,
          limit,
          total,
          pages,
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
      if (!followUpStatus) {
        res.status(400).json({ success: false, error: 'Valid follow-up status is required' });
        return;
      }

      let user: any = null;
      try {
        const result = await userServiceClient.getUser(userId, req.admin!.userId);
        user = result?.data || result;
      } catch (error: any) {
        logger.warn('Update KYC follow-up user lookup failed', { userId, error: error.message });
      }
      const profileUid = resolveProfileUid(user, userId);

      let followUpDate = req.body?.followUpDate ? new Date(req.body.followUpDate) : null;
      if (followUpStatus === 'follow_up' && (!followUpDate || Number.isNaN(followUpDate.getTime()))) {
        followUpDate = new Date();
      }

      const reviewStatus = normalizeReviewStatus(req.body?.reviewStatus) || (followUpStatus === 'none' ? 'pending' : 'rejected');
      const review = await KycReview.findOneAndUpdate(
        { userId: profileUid, sessionId: req.body?.sessionId || '' },
        {
          $set: {
            userId: profileUid,
            sessionId: req.body?.sessionId || '',
            verificationId: req.body?.verificationId || '',
            reviewStatus,
            followUpStatus,
            followUpDate: followUpStatus === 'follow_up' ? followUpDate : null,
            reviewedBy: actor(req),
            reviewedAt: new Date(),
            ...(reviewStatus === 'pending' ? { rejectionReason: '' } : {}),
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
