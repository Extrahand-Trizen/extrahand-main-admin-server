import { Request, Response } from 'express';
import { env } from '../config/env';
import logger from '../config/logger';
import { AdminNotification } from '../models/AdminNotification';
import { AdminUser } from '../models/AdminUser';
import { KycFollowUpStatus, KycReview, KycReviewStatus } from '../models/KycReview';
import { KycSession } from '../models/KycSession';
import { DashboardType } from '../types/dashboard';
import { userServiceClient } from '../services/UserServiceClient';
import { minioService } from '../services/MinioService';
import { createAadhaarKycAdminNotification } from '../services/AadhaarKycNotificationService';
import { listAllAadhaarKycAdmins } from '../services/AadhaarKycRecipientService';

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
  logger.debug('getVaultKeysForSession called', { userId, verificationId, hasSessionOcr: !!sessionOcr });
  const merged = new Map<string, { key: string; label: string }>();

  if (sessionOcr?.frontImageKey) {
    logger.debug('Adding sessionOcr frontImageKey', { key: sessionOcr.frontImageKey });
    merged.set(sessionOcr.frontImageKey, {
      key: sessionOcr.frontImageKey,
      label: 'Aadhaar front',
    });
  }
  if (sessionOcr?.backImageKey) {
    logger.debug('Adding sessionOcr backImageKey', { key: sessionOcr.backImageKey });
    merged.set(sessionOcr.backImageKey, {
      key: sessionOcr.backImageKey,
      label: 'Aadhaar back',
    });
  }

  if (verificationId && userId) {
    const prefix = buildVaultSessionPrefix(userId, verificationId);
    logger.debug('Searching MinIO prefix for vault keys', { userId, verificationId, prefix });
    const objects = await minioService.listObjectKeys(prefix);
    logger.debug('MinIO listObjectKeys result', { prefix, objectCount: objects.length, objects });
    for (const item of pickLatestVaultSideKeys(objects)) {
      logger.debug('Adding vault key from MinIO', { key: item.key, label: item.label });
      merged.set(item.key, item);
    }
  }

  const ordered: Array<{ key: string; label: string }> = [];
  for (const item of merged.values()) {
    if (item.label === 'Aadhaar front') ordered.unshift(item);
    else if (item.label === 'Aadhaar back') ordered.push(item);
    else ordered.push(item);
  }

  logger.debug('getVaultKeysForSession result', { verificationId, finalKeysCount: ordered.length, keys: ordered.map(k => ({ key: k.key, label: k.label })) });
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

      // 1. If this is an admin-upload session, search that MinIO prefix ONLY.
      //    Admin uploads store objects under aadhaar-ocr/{userId}/{adminSessionId}/
      //    When admin upload exists AND has images, return them immediately.
      //    This prevents old KycSession images from shadowing fresh uploads.
      if (adminSessionId && adminSessionId.startsWith('admin_upload_')) {
        logger.info('🔍 Admin upload session detected', { adminSessionId, userId });
        const adminKeys = await getVaultKeysForSession(userId, adminSessionId, undefined);
        logger.info('📋 Admin vault keys lookup result', { adminSessionId, userId, keyCount: adminKeys.length, keys: adminKeys.map((k: any) => k.key) });
        if (adminKeys.length > 0) {
          const adminDocs = await minioService.getPresignedUrls(adminKeys);
          logger.info('🔗 Presigned URLs generated from admin keys', { adminSessionId, userId, urlCount: adminDocs.length });
          if (adminDocs.length > 0) {
            logger.info('✅ RETURNING admin-upload images from vault', {
              adminSessionId,
              userId,
              count: adminDocs.length,
              labels: adminDocs.map((d: any) => d.label),
            });
            return adminDocs;
          }
        }
        // Admin upload session exists but no vault images found yet.
        // Skip old KycSession lookup to prevent showing stale DigiLocker/OCR images.
        // Only fall back to legacy documents stored on user profile.
        logger.info('⚠️  Admin upload has no vault images yet, skipping old KycSession, checking legacy docs', {
          adminSessionId,
          userId,
        });
        // Skip KycSession lookup entirely when admin upload was initiated
        // Jump directly to legacy documents fallback below
      } else {
        // 2. Only search KycSession if there's NO fresh admin upload
        //    Prefer exact verification_id match (DigiLocker / OCR sessions), then fall
        //    back to the latest OCR session for the user.
        logger.debug('Searching for KycSession (no admin upload)', { verificationId, userId });
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
  // Used when: admin upload has no vault images yet, OR no KycSession images found
  logger.info('📦 Checking legacy documents/imageUrls fallback', { userId, adminSessionId, verificationId });
  const rawDocuments = user?.aadhaarKyc?.documents;
  if (Array.isArray(rawDocuments) && rawDocuments.length > 0) {
    logger.info('✅ RETURNING legacy documents', { userId, count: rawDocuments.length, labels: rawDocuments.map((d: any) => d.label) });
    return rawDocuments
      .map((item: any, index: number) => ({
        label: String(item?.label || `Aadhaar image ${index + 1}`),
        url: String(item?.url || ''),
      }))
      .filter((item: { label: string; url: string }) => item.url);
  }

  const imageUrls = Array.isArray(user?.aadhaarKyc?.imageUrls) ? user.aadhaarKyc.imageUrls : [];
  logger.info('📦 Checking legacy imageUrls fallback', { userId, urlCount: imageUrls.length });
  const result = imageUrls
    .map((url: unknown, index: number) => ({
      label: `Aadhaar image ${index + 1}`,
      url: String(url || ''),
    }))
    .filter((item: { label: string; url: string }) => item.url);
  logger.info('❌ NO IMAGES FOUND, returning empty/imageUrls result', { userId, count: result.length });
  return result;
}

async function buildReviewRows(req: Request) {
  // Notification-driven approach: only show users who have triggered an Aadhaar
  // KYC review event (aadhaar_verification_failed or aadhaar_verification_under_review).
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

  // Also query KycReview and KycSession to collect other userIds (expired and reuploadeds)
  const [pendingReviews, kycSessions] = await Promise.all([
    KycReview.find({
      $or: [
        { reviewStatus: 'pending' },
        { followUpStatus: 'followup_uploaded' },
      ],
    }).lean(),
    KycSession.find({
      sessionType: { $regex: '^aadhaar', $options: 'i' },
      visibleStatus: { $in: ['expired', 'under_review', 'failed', 'rejected', 'pending'] },
    }).lean(),
  ]);

  const userIdsSet = new Set<string>(latestByUserId.keys());
  for (const review of pendingReviews) {
    const userId = String(review.userId || '').trim();
    if (userId) userIdsSet.add(userId);
  }
  for (const session of kycSessions) {
    const userId = String(session.userId || '').trim();
    if (userId) userIdsSet.add(userId);
  }

  const userIds = Array.from(userIdsSet);

  // Resolve all user profiles and UIDs to avoid mismatches in parallel
  const resolvedUsers = await Promise.all(
    userIds.map(async (userId) => {
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
      return { userId, user, profileUid };
    })
  );

  const resolvedUserMap = new Map<string, { user: any; profileUid: string }>();
  const allLookupIds = new Set<string>();
  for (const item of resolvedUsers) {
    resolvedUserMap.set(item.userId, { user: item.user, profileUid: item.profileUid });
    allLookupIds.add(item.userId);
    allLookupIds.add(item.profileUid);
  }

  const reviewDocs = await KycReview.find({ userId: { $in: Array.from(allLookupIds) } })
    .sort({ updatedAt: -1 })
    .lean();
  const reviewMap = new Map<string, any>();
  for (const review of reviewDocs) {
    reviewMap.set(`${review.userId}:${review.sessionId || ''}`, review);
    // Always map userId → latest review (sorted by updatedAt -1)
    if (!reviewMap.has(review.userId)) {
      reviewMap.set(review.userId, review);
    }
  }
  const fallbackReviewMap = new Map<string, any>();
  for (const review of reviewDocs) {
    // Keep only the first (latest) per userId
    if (!fallbackReviewMap.has(review.userId)) {
      fallbackReviewMap.set(review.userId, review);
    }
  }

  const rowPromises = userIds.map(async (userId) => {
    const notification = latestByUserId.get(userId);
    const resolved = resolvedUserMap.get(userId);
    const user = resolved?.user || null;
    const profileUid = resolved?.profileUid || userId;

    // aadhaarKyc.verificationId = the `verification_id` (eh_...) string stored in KycSession.
    // aadhaarKyc.id             = MongoDB _id — do NOT use for KycSession lookup.
    const verificationId = String(
      user?.aadhaarKyc?.verificationId ||
      notification?.metadata?.verificationId ||
      notification?.metadata?.sessionId ||
      '',
    );
    // sessionId is used for KycReview record keying (can be verificationId or a legacy id)
    const sessionId = verificationId || String(user?.aadhaarKyc?.id || '');
    
    // ALWAYS USE LATEST REVIEW - it has the most recent sessionId (admin_upload_ or verified)
    // Bypassing exact match prevents stale verificationId from blocking latest uploads
    const review = fallbackReviewMap.get(profileUid) || fallbackReviewMap.get(userId) || null;
    const hasNewUploadAfterReview =
      !Boolean(sessionId === review?.sessionId) && Boolean(sessionId) && Boolean(review?.sessionId);

    const claimedBy = review?.claimedBy || null;
    const claimedAt = review?.claimedAt || null;

    // Detect manual admin-upload sessions (sessionId starts with "admin_upload_").
    // The review document holds the canonical admin sessionId even when verificationId
    // points to an older DigiLocker session, so we must use it for MinIO lookup.
    const isManualUpload = Boolean(review?.sessionId && String(review.sessionId).startsWith('admin_upload_'));
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

    return {
      notificationId: notification ? String(notification._id) : '',
      userId,
      userName: user?.name || notification?.metadata?.userName || 'Unknown user',
      userEmail: user?.email || notification?.metadata?.userEmail || '',
      userPhone: user?.phone || notification?.metadata?.userPhone || '',
      registeredAt: String(user?.createdAt || user?.created_at || notification?.createdAt || ''),
      aadhaar: getAadhaarStatus(user, notification) || 'Under Review',
      failureReason:
        user?.aadhaarKyc?.failureReason ||
        notification?.metadata?.failureReason ||
        review?.rejectionReason ||
        '',
      failedOn:
        user?.aadhaarKyc?.visibleFailureAt ||
        notification?.createdAt ||
        user?.aadhaarKyc?.updatedAt ||
        null,
      // Use notification.createdAt as the primary sort key — this is the immutable
      // timestamp of the KYC event (failure / under-review trigger). Falling back to
      // aadhaarKyc.updatedAt only when no notification exists (e.g. KycSession-only rows).
      // Do NOT prefer aadhaarKyc.updatedAt first: it gets mutated whenever an admin
      // verifies/accepts the user, causing accepted users to sort above pending ones.
      aadhaarUpdatedAt: notification?.createdAt || user?.aadhaarKyc?.updatedAt || null,
      followUpStatus: hasNewUploadAfterReview ? 'followup_uploaded' : review?.followUpStatus || 'none',
      followUpDate: review?.followUpDate || null,
      claimedBy,
      claimedAt,
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
    };
  });

  const rows = await Promise.all(rowPromises);
  return rows;
}

/**
 * Like buildReviewRows but scoped to a known list of userIds.
 * Used by myClaims so that claimed reviews always appear regardless of whether
 * the user has a recent notification or a pending KycSession.
 */
async function buildReviewRowsForUserIds(req: Request, userIds: string[]) {
  if (userIds.length === 0) return [];

  // Deduplicate
  const uniqueUserIds = Array.from(new Set(userIds));

  // Fetch all notifications for these users (no limit, scoped to these users)
  const notifications = await AdminNotification.find({
    dashboardType: DashboardType.MAIN_ADMIN,
    type: { $in: AADHAAR_NOTIFICATION_TYPES },
    'metadata.userId': { $in: uniqueUserIds },
  })
    .sort({ createdAt: -1 })
    .lean();

  const latestByUserId = new Map<string, any>();
  for (const notification of notifications) {
    const userId = String(notification.metadata?.userId || '').trim();
    if (!userId || latestByUserId.has(userId)) continue;
    latestByUserId.set(userId, notification);
  }

  // Resolve all user profiles
  const resolvedUsers = await Promise.all(
    uniqueUserIds.map(async (userId) => {
      let user: any = null;
      try {
        const result = await userServiceClient.getUser(userId, req.admin!.userId);
        user = result?.data || result;
      } catch (error: any) {
        logger.warn('KYC review user enrichment failed (myClaims)', {
          userId,
          error: error.message,
        });
      }
      const profileUid = resolveProfileUid(user, userId);
      return { userId, user, profileUid };
    })
  );

  const resolvedUserMap = new Map<string, { user: any; profileUid: string }>();
  const allLookupIds = new Set<string>();
  for (const item of resolvedUsers) {
    resolvedUserMap.set(item.userId, { user: item.user, profileUid: item.profileUid });
    allLookupIds.add(item.userId);
    allLookupIds.add(item.profileUid);
  }

  const reviewDocs = await KycReview.find({ userId: { $in: Array.from(allLookupIds) } })
    .sort({ updatedAt: -1 })
    .lean();
  const reviewMap = new Map<string, any>();
  for (const review of reviewDocs) {
    reviewMap.set(`${review.userId}:${review.sessionId || ''}`, review);
    // Always map userId → latest review (sorted by updatedAt -1)
    if (!reviewMap.has(review.userId)) {
      reviewMap.set(review.userId, review);
    }
  }
  const fallbackReviewMap = new Map<string, any>();
  for (const review of reviewDocs) {
    // Keep only the first (latest) per userId
    if (!fallbackReviewMap.has(review.userId)) {
      fallbackReviewMap.set(review.userId, review);
    }
  }

  const rowPromises = uniqueUserIds.map(async (userId) => {
    const notification = latestByUserId.get(userId);
    const resolved = resolvedUserMap.get(userId);
    const user = resolved?.user || null;
    const profileUid = resolved?.profileUid || userId;

    const verificationId = String(
      user?.aadhaarKyc?.verificationId ||
      notification?.metadata?.verificationId ||
      notification?.metadata?.sessionId ||
      '',
    );
    const sessionId = verificationId || String(user?.aadhaarKyc?.id || '');

    // ALWAYS USE LATEST REVIEW - it has the most recent sessionId (admin_upload_ or verified)
    // Bypassing exact match prevents stale verificationId from blocking latest uploads
    const review = fallbackReviewMap.get(profileUid) || fallbackReviewMap.get(userId) || null;
    const hasNewUploadAfterReview =
      !Boolean(sessionId === review?.sessionId) && Boolean(sessionId) && Boolean(review?.sessionId);

    const claimedBy = review?.claimedBy || null;
    const claimedAt = review?.claimedAt || null;

    const isManualUpload = Boolean(review?.sessionId && String(review.sessionId).startsWith('admin_upload_'));
    const uploadedBy = review?.uploadedBy || null;

    const adminSessionId =
      (review?.sessionId && String(review.sessionId).startsWith('admin_upload_')
        ? review.sessionId
        : undefined) ||
      (notification?.metadata?.sessionId && String(notification.metadata.sessionId).startsWith('admin_upload_')
        ? notification.metadata.sessionId
        : undefined);

    const documents = await getAadhaarDocuments(user, verificationId, userId, adminSessionId);

    return {
      notificationId: notification ? String(notification._id) : '',
      userId,
      userName: user?.name || notification?.metadata?.userName || 'Unknown user',
      userEmail: user?.email || notification?.metadata?.userEmail || '',
      userPhone: user?.phone || notification?.metadata?.userPhone || '',
      registeredAt: String(user?.createdAt || user?.created_at || notification?.createdAt || ''),
      aadhaar: getAadhaarStatus(user, notification) || 'Under Review',
      failureReason:
        user?.aadhaarKyc?.failureReason ||
        notification?.metadata?.failureReason ||
        review?.rejectionReason ||
        '',
      failedOn:
        user?.aadhaarKyc?.visibleFailureAt ||
        notification?.createdAt ||
        user?.aadhaarKyc?.updatedAt ||
        null,
      // Same fix as buildReviewRows: prefer notification.createdAt (immutable event time).
      aadhaarUpdatedAt: notification?.createdAt || user?.aadhaarKyc?.updatedAt || null,
      followUpStatus: hasNewUploadAfterReview ? 'followup_uploaded' : review?.followUpStatus || 'none',
      followUpDate: review?.followUpDate || null,
      claimedBy,
      claimedAt,
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
    };
  });

  const rows = await Promise.all(rowPromises);
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
            claimedBy: null,
            claimedAt: null,
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
          claimedBy: review.claimedBy || null,
          claimedAt: review.claimedAt || null,
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

      // Restrict upload if claimed by someone else
      const review = await KycReview.findOne({ userId }).sort({ updatedAt: -1 }).lean();
      if (review && review.claimedBy && review.claimedBy.userId !== req.admin!.userId && !req.admin!.isSuperAdmin) {
        res.status(403).json({ success: false, error: 'This review is claimed by another admin' });
        return;
      }

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
        // Upsert KycReview keyed by userId only (not sessionId)
        // This ensures re-uploads for same user UPDATE the existing review instead of creating a new one
        // IMPORTANT: Preserve claimedBy and reviewStatus on re-upload
        try {
          // First check if review already exists
          const existingReview = await KycReview.findOne({ userId }).lean();
          
          // Always update these fields
          const baseUpdate: any = {
            userId,
            sessionId,
            uploadedBy: {
              userId: req.admin!.userId,
              email: req.admin!.email,
              name: req.admin!.name,
            },
            uploadedAt: new Date(),
          };

          // On first upload (new review), also set initial status
          if (!existingReview) {
            baseUpdate.verificationId = existingVerificationId || '';
            baseUpdate.reviewStatus = 'pending';
            baseUpdate.followUpStatus = 'none';
            baseUpdate.followUpDate = null;
            baseUpdate.rejectionReason = '';
          }
          // On re-upload: preserve existing claimedBy, reviewStatus, etc - only update images

          await KycReview.findOneAndUpdate(
            { userId },
            { $set: baseUpdate },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );
          
          logger.info('KycReview updated after admin upload', {
            userId,
            isNewReview: !existingReview,
            sessionId,
          });
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
      const sortOrder = String(req.query.sortOrder || 'newest').trim().toLowerCase();
      const page = Math.max(1, parseInt(String(req.query.page || '1')));
      const limit = Math.max(1, parseInt(String(req.query.limit || '20')));

      let rows = await buildReviewRows(req);

      // Filter: operations admin only sees unclaimed reviews
      if (!req.admin?.isSuperAdmin) {
        rows = rows.filter((row) => !row.claimedBy);
      }

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

      if (search) {
        rows = rows.filter((row) =>
          [
            row.userName,
            row.userEmail,
            row.userPhone,
            row.userId,
            row.aadhaar,
            row.failureReason,
            row.claimedBy ? `${row.claimedBy.name} ${row.claimedBy.email}` : '',
          ]
            .join(' ')
            .toLowerCase()
            .includes(search),
        );
      }

      // Sort by the most recent Aadhaar-related event timestamp.
      // For manual admin uploads: use uploadedAt (the upload event).
      // For all others: use aadhaarUpdatedAt (the notification/event time — failure, review, etc.).
      // This is consistent between environments and prevents accepted/verified users from
      // sorting above pending ones due to a recent aadhaarKyc.updatedAt verification timestamp.
      rows.sort((a, b) => {
        const aTime = a.isManualUpload
          ? (a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0)
          : (a.aadhaarUpdatedAt ? new Date(a.aadhaarUpdatedAt).getTime() : 0);
        const bTime = b.isManualUpload
          ? (b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0)
          : (b.aadhaarUpdatedAt ? new Date(b.aadhaarUpdatedAt).getTime() : 0);

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

  static async claim(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;
    try {
      const { userId } = req.params;
      const { sessionId } = req.body || {};

      let user: any = null;
      try {
        const result = await userServiceClient.getUser(userId, req.admin!.userId);
        user = result?.data || result;
      } catch (error: any) {
        logger.warn('Claim KYC review: user lookup failed', { userId, error: error.message });
      }
      const profileUid = resolveProfileUid(user, userId);

      const query = sessionId ? { userId: profileUid, sessionId } : { userId: profileUid };
      let review = await KycReview.findOne(query).sort({ updatedAt: -1 });

      if (review && review.claimedBy && review.claimedBy.userId !== req.admin!.userId) {
        res.status(409).json({ success: false, error: `Review is already claimed by ${review.claimedBy.name}` });
        return;
      }

      const adminActor = actor(req);
      if (!review) {
        review = new KycReview({
          userId: profileUid,
          sessionId: sessionId || '',
          reviewStatus: 'pending',
          followUpStatus: 'none',
          claimedBy: adminActor,
          claimedAt: new Date(),
        });
        await review.save();
      } else {
        review.claimedBy = adminActor;
        review.claimedAt = new Date();
        await review.save();
      }

      res.json({ success: true, data: review });
    } catch (error: any) {
      logger.error('Claim KYC review error:', error);
      res.status(500).json({ success: false, error: 'Failed to claim KYC review' });
    }
  }

  static async unclaim(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;
    try {
      const { userId } = req.params;
      const { sessionId } = req.body || {};

      let user: any = null;
      try {
        const result = await userServiceClient.getUser(userId, req.admin!.userId);
        user = result?.data || result;
      } catch (error: any) {
        logger.warn('Unclaim KYC review: user lookup failed', { userId, error: error.message });
      }
      const profileUid = resolveProfileUid(user, userId);

      const query = sessionId ? { userId: profileUid, sessionId } : { userId: profileUid };
      const review = await KycReview.findOne(query).sort({ updatedAt: -1 });

      if (!review) {
        res.status(404).json({ success: false, error: 'KYC review not found' });
        return;
      }

      if (review.claimedBy && review.claimedBy.userId !== req.admin!.userId && !req.admin!.isSuperAdmin) {
        res.status(403).json({ success: false, error: 'You are not the claimer of this review' });
        return;
      }

      review.claimedBy = undefined;
      review.claimedAt = undefined;
      await review.save();

      res.json({ success: true, data: review });
    } catch (error: any) {
      logger.error('Unclaim KYC review error:', error);
      res.status(500).json({ success: false, error: 'Failed to unclaim KYC review' });
    }
  }

  static async transfer(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;
    try {
      const { userId } = req.params;
      const { sessionId, targetAdminUserId } = req.body || {};

      if (!targetAdminUserId) {
        res.status(400).json({ success: false, error: 'targetAdminUserId is required' });
        return;
      }

      let user: any = null;
      try {
        const result = await userServiceClient.getUser(userId, req.admin!.userId);
        user = result?.data || result;
      } catch (error: any) {
        logger.warn('Transfer KYC review: user lookup failed', { userId, error: error.message });
      }
      const profileUid = resolveProfileUid(user, userId);

      const query = sessionId ? { userId: profileUid, sessionId } : { userId: profileUid };
      const review = await KycReview.findOne(query).sort({ updatedAt: -1 });

      if (!review) {
        res.status(404).json({ success: false, error: 'KYC review not found' });
        return;
      }

      if (review.claimedBy && review.claimedBy.userId !== req.admin!.userId && !req.admin!.isSuperAdmin) {
        res.status(403).json({ success: false, error: 'You are not the claimer of this review' });
        return;
      }

      const targetAdmin = await AdminUser.findOne({ userId: targetAdminUserId, status: 'active' }).lean();
      if (!targetAdmin) {
        res.status(404).json({ success: false, error: 'Target admin not found or inactive' });
        return;
      }

      review.claimedBy = {
        userId: targetAdmin.userId,
        email: targetAdmin.email,
        name: targetAdmin.name,
      };
      review.claimedAt = new Date();
      await review.save();

      res.json({ success: true, data: review });
    } catch (error: any) {
      logger.error('Transfer KYC review error:', error);
      res.status(500).json({ success: false, error: 'Failed to transfer KYC review' });
    }
  }

  static async myClaims(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;

    try {
      const search = String(req.query.search || '').trim().toLowerCase();
      const reviewStatus = String(req.query.reviewStatus || 'all').trim().toLowerCase();
      const followUpStatus = String(req.query.followUpStatus || 'all').trim().toLowerCase();
      const includeVerified = String(req.query.includeVerified || 'false').trim().toLowerCase() === 'true';
      const sortOrder = String(req.query.sortOrder || 'newest').trim().toLowerCase();
      const page = Math.max(1, parseInt(String(req.query.page || '1')));
      const limit = Math.max(1, parseInt(String(req.query.limit || '20')));

      // DEBUG: Log admin info
      const adminUserId = req.admin!.userId;
      logger.debug('My Claims request', {
        adminUserId,
        adminEmail: req.admin!.email,
        adminName: req.admin!.name,
        filters: { reviewStatus, followUpStatus, includeVerified, sortOrder, page, limit },
      });

      // Fetch ALL reviews claimed by this admin directly — this is the source-of-truth
      // for My Claims and ensures claimed leads are never dropped, even if they don't
      // appear in the notification window or have non-pending KycSession statuses.
      let claimedReviews = await KycReview.find({
        'claimedBy.userId': adminUserId,
      }).lean();
      
      logger.debug('My Claims database query (by userId)', {
        adminUserId,
        adminEmail: req.admin!.email,
        claimedReviewsCount: claimedReviews.length,
        firstReviewUserId: claimedReviews[0]?.userId,
        firstReviewClaimedBy: claimedReviews[0]?.claimedBy,
      });

      // FALLBACK: If no reviews found by userId, try by email (handles userId mismatch scenarios)
      if (claimedReviews.length === 0) {
        logger.warn('No claimed reviews found by userId, trying by email', { adminUserId, adminEmail: req.admin!.email });
        claimedReviews = await KycReview.find({
          'claimedBy.email': req.admin!.email,
        }).lean();
        
        logger.debug('My Claims database query (by email fallback)', {
          adminUserId,
          adminEmail: req.admin!.email,
          claimedReviewsCount: claimedReviews.length,
        });
      }
      
      const claimedUserIds = claimedReviews.map((r) => String(r.userId || '').trim()).filter(Boolean);

      // For myClaims, build rows DIRECTLY from claimed KycReview records
      // (don't require notifications to exist, unlike the main list)
      let rows: any[] = [];
      
      if (claimedReviews.length > 0) {
        // Fetch user data for enrichment (but don't fail if users don't exist)
        const userMap = new Map<string, any>();
        await Promise.all(
          claimedUserIds.map(async (userId) => {
            try {
              const result = await userServiceClient.getUser(userId, req.admin!.userId);
              const user = result?.data || result;
              userMap.set(userId, user);
            } catch (error: any) {
              logger.debug('KYC review user enrichment skipped (user not found)', {
                userId,
                error: error.message,
              });
              // Continue without user data
              userMap.set(userId, null);
            }
          })
        );

        // Also fetch notifications for enrichment (as secondary data source)
        const notificationData = new Map<string, any>();
        try {
          const notifications = await AdminNotification.find({
            dashboardType: DashboardType.MAIN_ADMIN,
            type: { $in: AADHAAR_NOTIFICATION_TYPES },
            'metadata.userId': { $in: claimedUserIds },
          })
            .sort({ createdAt: -1 })
            .lean();

          for (const notification of notifications) {
            const userId = String(notification.metadata?.userId || '').trim();
            if (userId && !notificationData.has(userId)) {
              notificationData.set(userId, notification);
            }
          }
        } catch (error: any) {
          logger.debug('Could not fetch enrichment notifications', { error: error.message });
        }

        // Build rows directly from KycReview records
        rows = claimedReviews.map((review) => {
          const userId = String(review.userId || '').trim();
          const user = userMap.get(userId);
          const notification = notificationData.get(userId);
          const isAadhaarVerified = isProfileAadhaarVerified(user);
          const aadhaarKyc = user?.aadhaarKyc || {};

          // Priority: User from service > Notification metadata > Fallback to admin names
          const userName = user?.name 
            || notification?.metadata?.userName 
            || review.uploadedBy?.name 
            || review.claimedBy?.name 
            || review.reviewedBy?.name 
            || 'Unknown';
          
          const userEmail = user?.email || '';
          const userPhone = user?.phone || user?.phoneNumber || '';
          
          // Priority: User aadhaarKyc > Notification metadata > Unknown
          const aadhaarStatus = aadhaarKyc?.internalStatus 
            || aadhaarKyc?.status 
            || notification?.metadata?.aadhaar 
            || 'unknown';

          return {
            notificationId: String(review._id || ''),
            userId: userId,
            userName: userName,
            userEmail: userEmail,
            userPhone: userPhone,
            aadhaar: String(aadhaarStatus).toLowerCase(),
            failureReason: aadhaarKyc?.failureReason || review.rejectionReason || '',
            failedOn: aadhaarKyc?.failedOn ? new Date(aadhaarKyc.failedOn).toISOString() : '',
            aadhaarUpdatedAt: aadhaarKyc?.updatedAt ? new Date(aadhaarKyc.updatedAt).toISOString() : '',
            followUpStatus: review.followUpStatus || 'none',
            followUpDate: review.followUpDate ? new Date(review.followUpDate).toISOString() : null,
            registeredAt: user?.registeredAt ? new Date(user.registeredAt).toISOString() : null,
            assignedTo: [], // Not applicable for my-claims
            claimedBy: review.claimedBy || null,
            claimedAt: review.claimedAt ? new Date(review.claimedAt).toISOString() : null,
            reviewStatus: review.reviewStatus || 'pending',
            reviewedBy: review.reviewedBy || null,
            reviewedAt: review.reviewedAt ? new Date(review.reviewedAt).toISOString() : null,
            sessionId: review.sessionId || '',
            verificationId: review.verificationId || aadhaarKyc?.verificationId || '',
            isAadhaarVerified: isAadhaarVerified,
            isManualUpload: Boolean(review.sessionId && String(review.sessionId).startsWith('admin_upload_')),
            uploadedBy: review.uploadedBy || null,
            uploadedAt: review.uploadedAt ? new Date(review.uploadedAt).toISOString() : null,
            documents: [],
            profileUrl: `/users/${encodeURIComponent(String(review.userId || ''))}?tab=verification`,
          };
        });
        
        logger.debug('Built rows from claimed KycReview records', {
          adminUserId,
          claimedReviewsCount: claimedReviews.length,
          rowsBuilt: rows.length,
        });
      }

      rows = rows.filter((row) => row.claimedBy?.userId === req.admin!.userId);

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

      if (search) {
        rows = rows.filter((row) =>
          [
            row.userName,
            row.userEmail,
            row.userPhone,
            row.userId,
            row.aadhaar,
            row.failureReason,
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
          : (a.aadhaarUpdatedAt ? new Date(a.aadhaarUpdatedAt).getTime() : 0);
        const bTime = b.isManualUpload
          ? (b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0)
          : (b.aadhaarUpdatedAt ? new Date(b.aadhaarUpdatedAt).getTime() : 0);

        const aDate = aTime || (a.registeredAt ? new Date(a.registeredAt).getTime() : 0);
        const bDate = bTime || (b.registeredAt ? new Date(b.registeredAt).getTime() : 0);

        if (sortOrder === 'oldest') return aDate - bDate;
        return bDate - aDate;
      });

      const total = rows.length;
      const startIndex = (page - 1) * limit;
      const paginatedRows = rows.slice(startIndex, startIndex + limit);
      const pages = Math.ceil(total / limit);

      logger.debug('My Claims result', {
        adminUserId,
        totalAfterFiltering: total,
        returnedCount: paginatedRows.length,
        pagination: { page, limit, total, pages },
      });

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
      logger.error('List my KYC claims error:', error);
      res.status(500).json({ success: false, error: 'Failed to list my KYC claims' });
    }
  }

  static async getDocuments(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;
    try {
      const { userId } = req.params;
      const sessionId = String(req.query.sessionId || '').trim();
      const verificationId = String(req.query.verificationId || '').trim();

      logger.info('🌐 getDocuments API called', { userId, sessionId, verificationId });

      let user: any = null;
      try {
        const result = await userServiceClient.getUser(userId, req.admin!.userId);
        user = result?.data || result;
      } catch (error: any) {
        logger.warn('Get KYC documents user lookup failed', { userId, error: error.message });
      }
      const profileUid = resolveProfileUid(user, userId);

      // ALWAYS fetch the latest KycReview for this user, regardless of the sessionId
      // passed from the frontend. The frontend may hold a stale DigiLocker sessionId
      // while the latest KycReview already has an admin_upload_ sessionId (from a
      // re-upload). Using the stale sessionId would miss the fresh images.
      const latestReview = await KycReview.findOne({ userId: profileUid })
        .sort({ updatedAt: -1 })
        .lean();

      // Also try the exact-match query in case the userId doesn't match the profileUid
      const exactReview =
        profileUid !== userId
          ? await KycReview.findOne({ userId }).sort({ updatedAt: -1 }).lean()
          : null;

      // Use whichever review is more recent
      let review = latestReview;
      if (exactReview && (!latestReview || new Date(exactReview.updatedAt ?? 0) > new Date(latestReview.updatedAt ?? 0))) {
        review = exactReview;
      }

      logger.info('📝 KycReview lookup result (latest)', {
        userId: profileUid,
        sessionId,
        foundReview: !!review,
        reviewSessionId: review?.sessionId,
        reviewUpdatedAt: review?.updatedAt,
      });

      // Determine the admin upload session ID from the latest review.
      // Priority: latest review's admin_upload_ sessionId > sessionId param if it's admin_upload_
      const adminSessionId =
        (review?.sessionId && String(review.sessionId).startsWith('admin_upload_')
          ? review.sessionId
          : undefined) ||
        (sessionId.startsWith('admin_upload_') ? sessionId : undefined);

      logger.info('🔑 Resolved adminSessionId for getDocuments', {
        userId: profileUid,
        sessionIdParam: sessionId,
        reviewSessionId: review?.sessionId,
        adminSessionId,
      });

      // Use the review's verificationId if available; otherwise fall back to param.
      // For admin uploads the verificationId from the review is the canonical one.
      const resolvedVerificationId =
        (review?.verificationId && !String(review.verificationId).startsWith('admin_upload_')
          ? review.verificationId
          : verificationId) || verificationId;

      const documents = await getAadhaarDocuments(user, resolvedVerificationId, userId, adminSessionId);
      logger.info('📤 getDocuments returning', {
        userId,
        docCount: documents.length,
        labels: documents.map((d: any) => d.label),
      });
      res.json({ success: true, data: documents });
    } catch (error: any) {
      logger.error('Get KYC documents error:', error);
      res.status(500).json({ success: false, error: 'Failed to get Aadhaar documents' });
    }
  }

  static async listOpsAdmins(req: Request, res: Response): Promise<void> {
    if (!requireKycReviewAccess(req, res)) return;
    try {
      const admins = await listAllAadhaarKycAdmins();
      res.json({ success: true, data: admins });
    } catch (error: any) {
      logger.error('List ops admins error:', error);
      res.status(500).json({ success: false, error: 'Failed to list operations admins' });
    }
  }
}
