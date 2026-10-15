import { Request, Response } from 'express';
import logger from '../config/logger';
import { AadhaarKycAssignment } from '../models/AadhaarKycAssignment';
import { KycReview } from '../models/KycReview';
import { Profile } from '../models/Profile';
import { userServiceClient } from '../services/UserServiceClient';
import { ensureKycAssigneeForUser } from '../services/AadhaarKycRecipientService';

const OPS_ROLES = ['operations_admin', 'operation_admin', 'operations'];

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

const CACHE_TTL_MS = 30_000; // 30 seconds cache
let cache: { rows: any[]; expiresAt: number } | null = null;
let buildPromise: Promise<any[]> | null = null;
let cacheVersion = 0;

export class AadhaarFollowUpController {
  /**
   * Invalidate the in-memory cache when assignments or follow-up statuses are updated
   */
  public static invalidateCache(): void {
    cacheVersion += 1;
    cache = null;
    buildPromise = null;
    logger.debug('AadhaarFollowUpController: cache invalidated');
  }

  /**
   * Pre-warm cache on server startup
   */
  public static warmCache(): void {
    AadhaarFollowUpController.getRows()
      .then((rows) => {
        logger.info(`✅ AadhaarFollowUpController: cache warmed with ${rows.length} rows`);
      })
      .catch((err) => {
        logger.warn('AadhaarFollowUpController: failed to warm cache on startup', err);
      });
  }

  /**
   * Build complete rows from database directly
   */
  private static async buildRows(): Promise<any[]> {
    let unverifiedHelpers: any[] = [];

    // Step 1: Query unverified helpers directly from MongoDB (Profiles)
    try {
      const profiles = await Profile.find({
        roles: { $in: ['tasker', 'both', 'helper'] },
        isAadhaarVerified: false,
      })
        .select('uid name email phone createdAt aadhaarKyc')
        .sort({ createdAt: -1 })
        .lean();

      unverifiedHelpers = profiles.map((p) => ({
        userId: String(p.uid || p._id || '').trim(),
        name: p.name || 'Unknown',
        email: p.email || '',
        phone: p.phone || '',
        createdAt: p.createdAt,
        aadhaarKyc: p.aadhaarKyc,
      }));
    } catch (dbErr: any) {
      logger.warn('AadhaarFollowUpController: direct Profile query failed, falling back to userServiceClient', dbErr);
      // Fallback to user-service if direct DB read encounters an issue
      try {
        const pageSize = 200;
        const firstResult = await userServiceClient.listUsers({
          role: 'helper',
          isAadhaarVerified: false,
          page: 1,
          limit: pageSize,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        });
        const firstUsers = firstResult?.data || firstResult?.users || [];
        unverifiedHelpers.push(...firstUsers);

        const totalPages = firstResult?.pagination?.pages || 1;
        if (totalPages > 1) {
          const remainingPageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
          const remainingResults = await Promise.all(
            remainingPageNums.map((p) =>
              userServiceClient.listUsers({
                role: 'helper',
                isAadhaarVerified: false,
                page: p,
                limit: pageSize,
                sortBy: 'createdAt',
                sortOrder: 'desc',
              }),
            ),
          );
          for (const res of remainingResults) {
            const users = res?.data || res?.users || [];
            if (Array.isArray(users)) unverifiedHelpers.push(...users);
          }
        }
      } catch (svcErr: any) {
        logger.error('AadhaarFollowUpController: fallback user service fetch also failed', svcErr);
        throw svcErr;
      }
    }

    const helperIds = unverifiedHelpers
      .map((u) => String(u.userId || u.uid || u._id || '').trim())
      .filter(Boolean);

    // Step 2: Parallel fetch of assignments and review statuses with minimal projection
    const [existingAssignments, reviewDocs] = await Promise.all([
      AadhaarKycAssignment.find({ userId: { $in: helperIds } })
        .select('userId assignedToUserId assignedToName assignedToEmail')
        .lean(),
      KycReview.find({ userId: { $in: helperIds } })
        .select('userId reviewStatus followUpStatus followUpDate reviewedBy reviewedAt')
        .lean(),
    ]);

    const assignmentMap = new Map<string, any>();
    for (const a of existingAssignments) {
      assignmentMap.set(a.userId, a);
    }

    const reviewMap = new Map<string, any>();
    for (const r of reviewDocs) {
      if (!reviewMap.has(r.userId)) {
        reviewMap.set(r.userId, r);
      }
    }

    // Step 3: Schedule background round-robin assignments for unassigned helpers (fire-and-forget)
    const unassignedIds = helperIds.filter((id) => !assignmentMap.has(id));
    if (unassignedIds.length > 0) {
      (async () => {
        const BATCH = 10;
        for (let i = 0; i < unassignedIds.length; i += BATCH) {
          const batch = unassignedIds.slice(i, i + BATCH);
          await Promise.allSettled(
            batch.map((userId) =>
              ensureKycAssigneeForUser(userId).catch((err) =>
                logger.warn('AadhaarFollowUpController: failed to assign helper', {
                  userId,
                  error: err.message,
                }),
              ),
            ),
          );
        }
      })();
    }

    // Step 4: Map compiled rows
    const rows: any[] = [];
    for (const user of unverifiedHelpers) {
      const userId = String(user.userId || user.uid || user._id || '').trim();
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
        ? review.followUpDate instanceof Date
          ? review.followUpDate.toISOString()
          : String(review.followUpDate)
        : null;

      rows.push({
        notificationId: userId,
        userId,
        userName: String(user.name || user.displayName || 'Unknown'),
        userEmail: String(user.email || ''),
        userPhone: String(user.phone || ''),
        registeredAt: user.createdAt
          ? user.createdAt instanceof Date
            ? user.createdAt.toISOString()
            : String(user.createdAt)
          : '',
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
        verificationId: String(user.aadhaarKyc?.verificationId || ''),
        isAadhaarVerified: false,
        isManualUpload: false,
        uploadedBy: null,
        uploadedAt: null,
        documents: [],
        profileUrl: `/users/${encodeURIComponent(userId)}?tab=verification`,
      });
    }

    return rows;
  }

  /**
   * Get cached rows with stale-while-revalidate so requests are ALWAYS instant
   */
  public static async getRows(): Promise<any[]> {
    const now = Date.now();

    // 1. Fresh cache: return immediately (< 10ms)
    if (cache && cache.expiresAt > now) {
      return cache.rows;
    }

    // 2. Stale-while-revalidate: serve stale cache immediately while refreshing in background
    if (cache && cache.rows.length > 0) {
      if (!buildPromise) {
        const currentVersion = cacheVersion;
        buildPromise = AadhaarFollowUpController.buildRows()
          .then((newRows) => {
            if (currentVersion === cacheVersion) {
              cache = { rows: newRows, expiresAt: Date.now() + CACHE_TTL_MS };
            }
            return newRows;
          })
          .catch((err) => {
            logger.warn('AadhaarFollowUpController: background refresh failed', err);
            return cache!.rows;
          })
          .finally(() => {
            buildPromise = null;
          });
      }
      return cache.rows;
    }

    // 3. Cold start: only on initial boot before cache is populated
    if (buildPromise) {
      return buildPromise;
    }

    const currentVersion = cacheVersion;
    buildPromise = AadhaarFollowUpController.buildRows();

    try {
      const rows = await buildPromise;
      if (currentVersion === cacheVersion) {
        cache = { rows, expiresAt: Date.now() + CACHE_TTL_MS };
      }
      return rows;
    } finally {
      buildPromise = null;
    }
  }

  /**
   * GET /api/v1/aadhaar-followups
   */
  static async list(req: Request, res: Response): Promise<void> {
    if (!requireAccess(req, res)) return;

    try {
      const search = String(req.query.search || '').trim().toLowerCase();
      const sortOrder = String(req.query.sortOrder || 'newest').trim().toLowerCase();
      const page = Math.max(1, parseInt(String(req.query.page || '1')));
      const limit = Math.max(1, parseInt(String(req.query.limit || '20')));
      const assignedToFilter = String(req.query.assignedTo || 'all').trim();
      const followUpStatusFilter = String(req.query.followUpStatus || 'all').trim();
      const reviewStatusFilter = String(req.query.reviewStatus || 'all').trim();

      const myAdminId = req.admin!.userId;
      const isSuperOrPlatform = isAllReviewsRole(req);

      // Fast retrieval from in-memory cache or direct DB
      const allRows = await AadhaarFollowUpController.getRows();
      let rows = allRows;

      // Filter by assigned ops admin
      if (!isSuperOrPlatform) {
        rows = rows.filter((row) =>
          row.assignedTo.some((a: any) => a.userId === myAdminId),
        );
      } else if (assignedToFilter !== 'all') {
        rows = rows.filter((row) =>
          row.assignedTo.some((a: any) => a.userId === assignedToFilter),
        );
      }

      // Filter by followUpStatus
      if (followUpStatusFilter !== 'all') {
        rows = rows.filter((row) => row.followUpStatus === followUpStatusFilter);
      }

      // Filter by reviewStatus
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

      // Filter by search
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

      // Sort
      rows = [...rows].sort((a, b) => {
        const aDate = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
        const bDate = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
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
        pagination: { page, limit, total, pages },
      });
    } catch (error: any) {
      logger.error('AadhaarFollowUpController.list error:', error);
      res.status(500).json({ success: false, error: 'Failed to list Aadhaar follow-ups' });
    }
  }
}
