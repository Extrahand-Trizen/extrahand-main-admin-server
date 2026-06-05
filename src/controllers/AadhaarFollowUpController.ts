import { Request, Response } from 'express';
import logger from '../config/logger';
import { AadhaarKycAssignment } from '../models/AadhaarKycAssignment';
import { KycReview } from '../models/KycReview';
import { userServiceClient } from '../services/UserServiceClient';
import {
  ensureKycAssigneeForUser,
  listAadhaarKycRecipients,
} from '../services/AadhaarKycRecipientService';
import { DashboardType } from '../types/dashboard';

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
          verificationId: String(user.aadhaarKyc?.verificationId || ''),
          isAadhaarVerified: false,
          isManualUpload: false,
          uploadedBy: null,
          uploadedAt: null,
          documents: [],
          profileUrl: `/users/${encodeURIComponent(userId)}?tab=verification`,
        });
      }

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
