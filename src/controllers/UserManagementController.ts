import { Request, Response } from 'express';
import { userServiceClient } from '../services/UserServiceClient';
import { onboardingServiceClient } from '../services/OnboardingServiceClient';
import { lookupPartnerLeadSource, PartnerLeadSource } from '../services/PartnerLeadSourceService';
import logger from '../config/logger';
import { createAuditLog } from '../middleware/audit';
import { Resource } from '../types/permissions';
import { getClientSafeStatus } from '../utils/upstreamHttp';
import { createAadhaarKycAdminNotification } from '../services/AadhaarKycNotificationService';

function getAadhaarNotificationType(user: any):
  | 'aadhaar_verification_failed'
  | 'aadhaar_verification_under_review'
  | null {
  if (user?.isAadhaarVerified) return null;
  const aadhaarKyc = user?.aadhaarKyc;
  if (!aadhaarKyc) return null;
  const statusText = [
    aadhaarKyc.visibleStatus,
    aadhaarKyc.internalStatus,
    aadhaarKyc.status,
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase();

  if (/(failed|failure|rejected|not verified|not_verified)/.test(statusText)) {
    return 'aadhaar_verification_failed';
  }
  if (/(under[_\s-]?review|review|pending)/.test(statusText)) {
    return 'aadhaar_verification_under_review';
  }
  return null;
}

async function ensureAadhaarOpsNotification(user: any): Promise<void> {
  const type = getAadhaarNotificationType(user);
  if (!type) return;

  const userId = String(user?.userId || user?.uid || '').trim();
  if (!userId) return;

  const status = type === 'aadhaar_verification_failed' ? 'failed' : 'under_review';
  await createAadhaarKycAdminNotification({
    type,
    userId,
    userName: user?.name,
    userEmail: user?.email,
    userPhone: user?.phone,
    status,
    failureReason: user?.aadhaarKyc?.failureReason,
    verificationId: user?.aadhaarKyc?.verificationId,
    sessionId: user?.aadhaarKyc?.verificationId || user?.aadhaarKyc?.id,
    occurredAt: new Date().toISOString(),
  });
}

export class UserManagementController {
  /**
   * GET /api/v1/users
   * List users
   */
  static async listUsers(req: Request, res: Response): Promise<void> {
    try {
      const params = {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        search: req.query.search as string,
        status: req.query.status as string,
        role: req.query.role as string,
        category: req.query.category as string,
        city: req.query.city as string,
        workArea: req.query.workArea as string,
        isAadhaarVerified:
          typeof req.query.isAadhaarVerified === 'string'
            ? req.query.isAadhaarVerified === 'true'
            : undefined,
        isCertified:
          typeof req.query.isCertified === 'string'
            ? req.query.isCertified === 'true'
            : undefined,
        createdFrom: req.query.createdFrom as string,
        createdTo: req.query.createdTo as string,
        area: req.query.area as string,
        includeSummary:
          typeof req.query.includeSummary === 'string'
            ? req.query.includeSummary === 'true'
            : undefined,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
        uids: req.query.uids as string,
      };
      
      const result = await userServiceClient.listUsers(params);
      
      res.json({
        success: true,
        data: result.data || [],
        pagination: result.pagination || {
          page: params.page || 1,
          limit: params.limit || 20,
          total: Array.isArray(result.data) ? result.data.length : 0,
          pages: 1,
        },
        summary: result.summary,
      });
    } catch (error: any) {
      logger.error('List users error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list users',
      });
    }
  }

  /**
   * GET /api/v1/users/areas/hyderabad
   * Distinct Hyderabad sub-areas for user filters.
   */
  static async getHyderabadSubAreas(req: Request, res: Response): Promise<void> {
    try {
      const result = await userServiceClient.getHyderabadSubAreas();
      res.json({
        success: true,
        data: result.data || [],
      });
    } catch (error: any) {
      logger.error('List Hyderabad sub-areas error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list Hyderabad sub-areas',
      });
    }
  }

  /**
   * GET /api/v1/users/helpers/search
   * Search helpers by name or phone (dedicated endpoint that handles service auth errors gracefully).
   */
  static async searchHelpers(req: Request, res: Response): Promise<void> {
    try {
      const search = (req.query.q as string || '').trim();
      if (!search || search.length < 2) {
        res.json({ success: true, data: [] });
        return;
      }

      const result = await userServiceClient.listUsers({
        search,
        role: 'Helper',
        limit: 20,
        page: 1,
      });

      res.json({
        success: true,
        data: result.data || [],
      });
    } catch (error: any) {
      logger.error('Search helpers error:', error);
      // Return empty array on auth errors instead of propagating the 403
      res.json({ success: true, data: [] });
    }
  }

  /**
   * GET  /api/v1/users/cleanup/no-role?dry_run=true   — preview (default)
   * POST /api/v1/users/cleanup/no-role               — execute (body: { dry_run: false })
   */
  static async cleanupUsersWithoutRoles(req: Request, res: Response): Promise<void> {
    try {
      const dryRunParam = req.query.dry_run ?? (req.body && req.body.dry_run);
      const dryRun = dryRunParam === undefined ? true : String(dryRunParam) !== 'false';

      const result = await userServiceClient.cleanupUsersWithoutRoles(dryRun);

      res.json(result);
    } catch (error: any) {
      logger.error('Cleanup no-role users error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to cleanup users without roles',
      });
    }
  }

  
  /**
   * GET /api/v1/users/:userId
   * Get user by ID
   */
  static async getUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      
      const result = await userServiceClient.getUser(userId, req.admin?.userId);
      const user = result.data || result;
      await ensureAadhaarOpsNotification(user);
      
      res.json({
        success: true,
        data: user,
      });
    } catch (error: any) {
      logger.error('Get user error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get user',
      });
    }
  }

  /**
   * GET /api/v1/users/:userId/registration-source
   * Returns partner portal vs self-registered information.
   */
  static async getUserRegistrationSource(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      const userResult = await userServiceClient.getUser(userId, req.admin?.userId);
      const user = userResult?.data || userResult;

      const email = user?.email as string | undefined;
      const phone = user?.phone as string | undefined;
      const uid = (user?.uid || user?.userId || userId) as string | undefined;

      if (!uid && !email && !phone) {
        res.json({
          success: true,
          data: {
            source: 'self_registered',
            addedByName: null,
            leadId: null,
          },
        });
        return;
      }

      let lead: PartnerLeadSource | null = null;

      if (onboardingServiceClient.isEnabled()) {
        try {
          const lookup = await onboardingServiceClient.lookupLeadByContact({
            uid,
            email,
            phone,
            adminUserId: req.admin?.userId,
          });

          const serviceLead = lookup?.data?.lead || null;
          if (lookup?.data?.exists && serviceLead?.leadId) {
            lead = {
              leadId: serviceLead.leadId,
              addedBy: serviceLead.addedBy,
              addedByName: serviceLead.addedByName || null,
              source: serviceLead.source || null,
              createdAt: serviceLead.createdAt,
              updatedAt: serviceLead.updatedAt,
            };
          }
        } catch (lookupError: any) {
          logger.warn('Onboarding service lead source lookup failed; falling back to local leads collection', {
            userId,
            error: lookupError.message,
          });
        }
      }

      if (!lead) {
        try {
          lead = await lookupPartnerLeadSource({ uid, email, phone });
        } catch (lookupError: any) {
          logger.warn('Local leads collection source lookup failed', {
            userId,
            error: lookupError.message,
          });
        }
      }

      res.json({
        success: true,
        data: {
          source: lead ? 'partner_portal' : 'self_registered',
          addedByName: lead?.addedByName || null,
          leadId: lead?.leadId || null,
        },
      });
    } catch (error: any) {
      logger.error('Get user registration source error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get registration source',
      });
    }
  }
  
  /**
   * PATCH /api/v1/users/:userId
   * Update user
   */
  static async updateUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      
      const result = await userServiceClient.updateUser(
        userId,
        req.body,
        req.admin!.userId
      );
      
      await createAuditLog(
        req,
        `${Resource.USER}.update`,
        Resource.USER,
        userId,
        { updates: req.body }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Update user error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update user',
      });
    }
  }
  
  /**
   * POST /api/v1/users/:userId/ban
   * Ban user
   */
  static async banUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      
      if (!reason) {
        res.status(400).json({
          success: false,
          error: 'Reason is required for banning a user',
        });
        return;
      }
      
      const result = await userServiceClient.banUser(
        userId,
        reason,
        req.admin!.userId
      );
      
      await createAuditLog(
        req,
        `${Resource.USER}.ban`,
        Resource.USER,
        userId,
        { reason },
        undefined,
        { status: 'banned' }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Ban user error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to ban user',
      });
    }
  }
  
  /**
   * POST /api/v1/users/:userId/unban
   * Unban user
   */
  static async unbanUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      
      const result = await userServiceClient.unbanUser(
        userId,
        req.admin!.userId
      );
      
      await createAuditLog(
        req,
        `${Resource.USER}.unban`,
        Resource.USER,
        userId,
        {},
        { status: 'banned' },
        { status: 'active' }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Unban user error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to unban user',
      });
    }
  }
  
  /**
   * POST /api/v1/users/:userId/suspend
   * Suspend user
   */
  static async suspendUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      
      if (!reason) {
        res.status(400).json({
          success: false,
          error: 'Reason is required for suspending a user',
        });
        return;
      }
      
      const result = await userServiceClient.suspendUser(
        userId,
        reason,
        req.admin!.userId
      );
      
      await createAuditLog(
        req,
        `${Resource.USER}.suspend`,
        Resource.USER,
        userId,
        { reason },
        undefined,
        { status: 'suspended' }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Suspend user error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to suspend user',
      });
    }
  }
  
  /**
   * POST /api/v1/users/:userId/unsuspend
   * Unsuspend user
   */
  static async unsuspendUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      
      const result = await userServiceClient.unsuspendUser(
        userId,
        req.admin!.userId
      );
      
      await createAuditLog(
        req,
        `${Resource.USER}.unsuspend`,
        Resource.USER,
        userId,
        {},
        { status: 'suspended' },
        { status: 'active' }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Unsuspend user error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to unsuspend user',
      });
    }
  }
}
