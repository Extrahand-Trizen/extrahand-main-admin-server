import { Request, Response } from 'express';
import logger from '../config/logger';
import { AadhaarKycAssignment } from '../models/AadhaarKycAssignment';
import { KycReview } from '../models/KycReview';
import { KycSession } from '../models/KycSession';
import { userServiceClient } from '../services/UserServiceClient';
import { minioService } from '../services/MinioService';
import {
  ensureKycAssigneeForUser,
  listAadhaarKycRecipients,
} from '../services/AadhaarKycRecipientService';
import { DashboardType } from '../types/dashboard';

const OPS_ROLES = ['operations_admin', 'operation_admin', 'operations'];

// Helper functions for document retrieval (similar to KycReviewController)
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

async function getAadhaarDocuments(
  user: any,
  verificationId: string,
  userId: string,
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
      //    When admin upload exists, we must NOT fall back to old KycSession images
      //    to avoid showing stale data after re-uploads.
      if (adminSessionId && adminSessionId.startsWith('admin_upload_')) {
        const adminKeys = await getVaultKeysForSession(userId, adminSessionId, undefined);
        if (adminKeys.length > 0) {
          const adminDocs = await minioService.getPresignedUrls(adminKeys);
          if (adminDocs.length > 0) {
            logger.debug('AadhaarFollowUpController: served admin-upload images from vault', {
              adminSessionId,
              userId,
              count: adminDocs.length,
            });
            return adminDocs;
          }
        }
        // Admin upload exists but images not yet in vault (race condition)
        logger.warn('AadhaarFollowUpController: admin-upload session exists but images not yet in vault', {
          adminSessionId,
          userId,
        });
        return [];
      }

      // 2. Only search KycSession if there's NO fresh admin upload
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
          logger.warn('AadhaarFollowUpController: KycSession had image keys but presigning returned none', {
            verificationId,
            userId,
            keys: keysToSign.map((item) => item.key),
          });
        }
      }
    } catch (error: any) {
      logger.warn('AadhaarFollowUpController: failed to fetch KycSession image keys', {
        verificationId,
        userId,
        error: error.message,
      });
    }
  }

  // Fallback: legacy documents / imageUrls stored on user profile
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

function isOperationsRole(role?: string): boolean {
  return OPS_ROLES.includes(role || '');
}

function isAllReviewsRole(req: Request): boolean {
  return Boolean(req.admin?.isSuperAdmin || req.admin?.role === 'platform_admin');
}

function hasAccess(req: Request): boolean {
  return Boolean(isAllReviewsRole(req) || isOperationsRole(req.admin?.role));
}

function requireAccess(req: Request, res: Response): boolean {
  if (!req.admin) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return false;
  }
  if (!hasAccess(req)) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return false;
  }
  return true;
}

export class AadhaarFollowUpController {
  /**
   * GET /api/v1/aadhaar-followups
   *
   * Returns ALL helpers whose Aadhaar is not verified, with equal round-robin
   * assignment across the 3 operations admins. Each helper is assigned exactly
   * once (sticky); subsequent calls return the same assignment.
   *
   * Supports: search, statusFilter, sortOrder (newest/oldest), page, limit,
   *           and assignedTo filtering (ops admin userId).
   */
  static async list(req: Request, res: Response): Promise<void> {
    if (!requireAccess(req, res)) return;

    try {
      const search = String(req.query.search || '').trim().toLowerCase();
      const sortOrder = String(req.query.sortOrder || 'newest').trim().toLowerCase();
      const page = Math.max(1, parseInt(String(req.query.page || '1')));
      const limit = Math.max(1, parseInt(String(req.query.limit || '20')));
      const assignedToFilter = String(req.query.assignedTo || 'all').trim();

      // Follow-up status filter (from the frontend status filter values)
      const followUpStatusFilter = String(req.query.followUpStatus || 'all').trim();
      const reviewStatusFilter = String(req.query.reviewStatus || 'all').trim();

      // ── Step 1: Fetch ALL helpers with Aadhaar not verified from user-service ──
      // We paginate at the user-service level with a large limit to get all unverified helpers.
      // User service supports isAadhaarVerified filter and role=helper filter.
      let allUnverifiedHelpers: any[] = [];
      try {
        let currentPage = 1;
        const pageSize = 100;
        while (true) {
          const result = await userServiceClient.listUsers({
            role: 'helper',
            isAadhaarVerified: false,
            page: currentPage,
            limit: pageSize,
            sortBy: 'createdAt',
            sortOrder: 'desc',
          });

          const users = result?.data || result?.users || [];
          if (!Array.isArray(users) || users.length === 0) break;
          allUnverifiedHelpers.push(...users);

          const pagination = result?.pagination;
          if (!pagination || currentPage >= pagination.pages) break;
          currentPage++;
        }
      } catch (err: any) {
        logger.error('AadhaarFollowUpController: failed to fetch unverified helpers', {
          error: err.message,
        });
        res.status(500).json({ success: false, error: 'Failed to fetch unverified helpers' });
        return;
      }

      // ── Step 2: Ensure every helper has an assignment (round-robin, idempotent) ──
      // We do this in batches to avoid overwhelming the DB.
      // For operations admins (non-super-admin), we only need to process helpers
      // assigned to them — but we still need to ensure all assignments exist first.
      const myAdminId = req.admin!.userId;
      const isSuperOrPlatform = isAllReviewsRole(req);

      // Collect all userIds
      const helperIds = allUnverifiedHelpers.map((u: any) =>
        String(u.userId || u._id || u.id || '').trim(),
      ).filter(Boolean);

      // Fetch all existing assignments in one query
      const existingAssignments = await AadhaarKycAssignment.find({
        userId: { $in: helperIds },
      }).lean();
      const assignmentMap = new Map<string, any>();
      for (const a of existingAssignments) {
        assignmentMap.set(a.userId, a);
      }

      // Assign any helpers that don't have an assignment yet
      const unassignedIds = helperIds.filter((id) => !assignmentMap.has(id));
      if (unassignedIds.length > 0) {
        logger.info(`AadhaarFollowUpController: assigning ${unassignedIds.length} new helpers via round-robin`);
        for (const userId of unassignedIds) {
          try {
            const assignee = await ensureKycAssigneeForUser(userId);
            if (assignee) {
              assignmentMap.set(userId, {
                userId,
                assignedToUserId: assignee.userId,
                assignedToEmail: assignee.email,
                assignedToName: assignee.name,
              });
            }
          } catch (assignErr: any) {
            logger.warn('AadhaarFollowUpController: failed to assign helper', {
              userId,
              error: assignErr.message,
            });
          }
        }
      }

      // ── Step 3: Fetch KycReview docs for follow-up status ──
      const reviewDocs = await KycReview.find({ userId: { $in: helperIds } })
        .sort({ updatedAt: -1 })
        .lean();
      const reviewMap = new Map<string, any>();
      for (const r of reviewDocs) {
        // Keep the most recent review per userId
        if (!reviewMap.has(r.userId)) {
          reviewMap.set(r.userId, r);
        }
      }

      // ── Step 4: Build response rows ──
      let rows: any[] = [];
      for (const user of allUnverifiedHelpers) {
        const userId = String(user.userId || user._id || user.id || '').trim();
        if (!userId) continue;

        const assignment = assignmentMap.get(userId);
        const review = reviewMap.get(userId);

        const assignedTo = assignment
          ? [
              {
                userId: assignment.assignedToUserId,
                name: assignment.assignedToName,
                email: assignment.assignedToEmail,
              },
            ]
          : [];

        const followUpStatus: string = review?.followUpStatus || 'none';
        const reviewStatus: string = review?.reviewStatus || 'pending';
        const followUpDate = review?.followUpDate
          ? review.followUpDate.toISOString?.() || String(review.followUpDate)
          : null;

        const verificationId = String(user.aadhaarKyc?.verificationId || '');
        const adminSessionId =
          (review?.sessionId && String(review.sessionId).startsWith('admin_upload_')
            ? review.sessionId
            : undefined);

        rows.push({
          // Use userId as notificationId to satisfy the frontend type
          notificationId: userId,
          userId,
          userName: String(user.name || user.displayName || 'Unknown'),
          userEmail: String(user.email || ''),
          userPhone: String(user.phone || ''),
          registeredAt: String(user.createdAt || user.created_at || ''),
          aadhaar: String(user.aadhaarKyc?.visibleStatus || user.aadhaarKyc?.status || 'Not verified'),
          failureReason: String(user.aadhaarKyc?.failureReason || ''),
          failedOn: user.aadhaarKyc?.updatedAt || null,
          aadhaarUpdatedAt: user.aadhaarKyc?.updatedAt || null,
          followUpStatus,
          followUpDate,
          assignedTo,
          reviewStatus,
          reviewedBy: review?.reviewedBy || null,
          reviewedAt: review?.reviewedAt || null,
          sessionId: String(user.aadhaarKyc?.verificationId || user.aadhaarKyc?.id || ''),
          verificationId,
          isAadhaarVerified: false,
          isManualUpload: adminSessionId ? true : false,
          uploadedBy: review?.uploadedBy || null,
          uploadedAt: review?.uploadedAt || null,
          documents: [],  // Will be populated in next step
          profileUrl: `/users/${encodeURIComponent(userId)}?tab=verification`,
          _user: user,  // Store user object temporarily
          _review: review,  // Store review object temporarily
        });
      }

      // ── Step 4b: Populate documents for all rows (async) ──
      await Promise.all(
        rows.map(async (row) => {
          try {
            const verificationId = String(row._user?.aadhaarKyc?.verificationId || '');
            const adminSessionId =
              (row._review?.sessionId && String(row._review.sessionId).startsWith('admin_upload_')
                ? row._review.sessionId
                : undefined);
            
            row.documents = await getAadhaarDocuments(
              row._user,
              verificationId,
              row.userId,
              adminSessionId,
            );
          } catch (error: any) {
            logger.warn('AadhaarFollowUpController: failed to fetch documents for user', {
              userId: row.userId,
              error: error.message,
            });
            row.documents = [];
          }
        })
      );

      // Clean up temporary fields
      rows = rows.map((row) => {
        delete row._user;
        delete row._review;
        return row;
      });

      // ── Step 5: Filter by assigned ops admin (for non-super-admins only see their own) ──
      if (!isSuperOrPlatform) {
        rows = rows.filter((row) =>
          row.assignedTo.some((a: any) => a.userId === myAdminId),
        );
      } else if (assignedToFilter !== 'all') {
        rows = rows.filter((row) =>
          row.assignedTo.some((a: any) => a.userId === assignedToFilter),
        );
      }

      // ── Step 6: Apply status filters ──
      if (followUpStatusFilter !== 'all') {
        rows = rows.filter((row) => row.followUpStatus === followUpStatusFilter);
      }
      if (reviewStatusFilter !== 'all') {
        if (reviewStatusFilter === 'pending') {
          rows = rows.filter(
            (row) =>
              row.reviewStatus !== 'accepted' &&
              row.reviewStatus !== 'rejected' &&
              row.followUpStatus === 'none',
          );
        } else {
          rows = rows.filter((row) => row.reviewStatus === reviewStatusFilter);
        }
      }

      // ── Step 7: Search filter ──
      if (search) {
        rows = rows.filter((row) =>
          [
            row.userName,
            row.userEmail,
            row.userPhone,
            row.userId,
            row.assignedTo.map((a: any) => `${a.name} ${a.email}`).join(' '),
          ]
            .join(' ')
            .toLowerCase()
            .includes(search),
        );
      }

      // ── Step 8: Sort ──
      rows.sort((a, b) => {
        const aDate = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
        const bDate = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
        if (sortOrder === 'oldest') return aDate - bDate;
        return bDate - aDate;
      });

      // ── Step 9: Paginate ──
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
      logger.error('AadhaarFollowUpController.list error:', error);
      res.status(500).json({ success: false, error: 'Failed to list Aadhaar follow-ups' });
    }
  }
}
