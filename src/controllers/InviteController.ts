import { Request, Response } from 'express';
import { AdminInvite } from '../models/AdminInvite';
import { AdminUser } from '../models/AdminUser';
import { PermissionService } from '../services/PermissionService';
import { DashboardType } from '../types/dashboard';
import logger from '../config/logger';
import { createAuditLog } from '../middleware/audit';
import axios from 'axios';
import { env } from '../config/env';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

export class InviteController {
  /**
   * POST /api/v1/admin/invites
   * Create admin invite
   */
  static async createInvite(req: Request, res: Response): Promise<void> {
    try {
      const { email, dashboardType, role, customMessage } = req.body;
      
      if (!email || !dashboardType || !role) {
        res.status(400).json({
          success: false,
          error: 'Email, dashboardType, and role are required',
        });
        return;
      }
      
      // Check if user already exists
      const existingUser = await AdminUser.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        res.status(400).json({
          success: false,
          error: 'User with this email already exists',
        });
        return;
      }
      
      // Check for pending invite
      const existingInvite = await AdminInvite.findOne({
        email: email.toLowerCase(),
        status: 'pending',
      });
      
      if (existingInvite && !existingInvite.isExpired()) {
        res.status(400).json({
          success: false,
          error: 'Pending invite already exists for this email',
        });
        return;
      }
      
      // Create invite
      const { invite, token } = await (AdminInvite as any).createInvite({
        email: email.toLowerCase(),
        dashboardType,
        role,
        invitedBy: req.admin!.userId,
        invitedByName: req.admin!.name,
        customMessage,
        expiresInDays: 7,
      });
      
      // Send invite email
      try {
        if (env.EMAIL_SERVICE_URL) {
          const origin = req.get('origin') || req.get('referer')?.replace(/\/$/, '') || env.MAIN_ADMIN_DASHBOARD_URL;
          const baseUrl = origin.replace(/\/$/, '');
          const inviteUrl = `${baseUrl}/accept-invite?token=${token}&inviteId=${invite.inviteId}`;

          const emailServiceAuthToken = env.EMAIL_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN;

          await axios.post(
            `${env.EMAIL_SERVICE_URL}/api/v1/email/admin-invite`,
            {
              email: email,
              role,
              inviteLink: inviteUrl,
              expiresAt: invite.expiresAt,
              name: email.split('@')[0],
              platformName: 'ExtraHand Main Admin',
            },
            {
              headers: {
                'X-Service-Auth': emailServiceAuthToken,
                'X-Service-Name': 'main-admin-server',
                'X-User-Id': req.admin!.userId,
              },
            }
          );
        }
      } catch (emailError: any) {
        logger.error('Failed to send invite email:', emailError);
        // Don't fail the request if email fails
      }
      
      await createAuditLog(
        req,
        'admin.invite.create',
        'admin_invite',
        invite.inviteId,
        { email, dashboardType, role }
      );
      
      res.status(201).json({
        success: true,
        data: {
          inviteId: invite.inviteId,
          email: invite.email,
          dashboardType: invite.dashboardType,
          role: invite.role,
          expiresAt: invite.expiresAt,
          // Don't send token in response - it's in the email
        },
      });
    } catch (error: any) {
      logger.error('Create invite error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create invite',
      });
    }
  }
  
  /**
   * GET /api/v1/admin/invites
   * List invites
   */
  static async listInvites(req: Request, res: Response): Promise<void> {
    try {
      const { page = 1, limit = 20, status, dashboardType } = req.query;
      
      const query: any = {};
      
      if (status) {
        query.status = status;
      }
      
      if (dashboardType) {
        query.dashboardType = dashboardType;
      }
      
      const skip = (Number(page) - 1) * Number(limit);
      
      const [invites, total] = await Promise.all([
        AdminInvite.find(query)
          .select('-token')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit)),
        AdminInvite.countDocuments(query),
      ]);
      
      res.json({
        success: true,
        data: {
          invites,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      logger.error('List invites error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list invites',
      });
    }
  }
  
  /**
   * POST /api/v1/admin/invites/:inviteId/resend
   * Resend invite email
   */
  static async resendInvite(req: Request, res: Response): Promise<void> {
    try {
      const { inviteId } = req.params;
      
      const invite = await AdminInvite.findOne({ inviteId });
      if (!invite) {
        res.status(404).json({
          success: false,
          error: 'Invite not found',
        });
        return;
      }
      
      if (invite.status !== 'pending') {
        res.status(400).json({
          success: false,
          error: 'Can only resend pending invites',
        });
        return;
      }
      
      if (invite.isExpired()) {
        res.status(400).json({
          success: false,
          error: 'Invite has expired',
        });
        return;
      }
      
      // Generate new token (old one is hashed, can't retrieve)
      const newToken = uuidv4();
      invite.token = await bcrypt.hash(newToken, 10);
      await invite.save();
      
      // Send email
      try {
        if (env.EMAIL_SERVICE_URL) {
          const origin = req.get('origin') || req.get('referer')?.replace(/\/$/, '') || env.MAIN_ADMIN_DASHBOARD_URL;
          const baseUrl = origin.replace(/\/$/, '');
          const inviteUrl = `${baseUrl}/accept-invite?token=${newToken}&inviteId=${invite.inviteId}`;

          const emailServiceAuthToken = env.EMAIL_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN;

          await axios.post(
            `${env.EMAIL_SERVICE_URL}/api/v1/email/admin-invite`,
            {
              email: invite.email,
              role: invite.role,
              inviteLink: inviteUrl,
              expiresAt: invite.expiresAt,
              name: invite.email.split('@')[0],
              platformName: 'ExtraHand Main Admin',
            },
            {
              headers: {
                'X-Service-Auth': emailServiceAuthToken,
                'X-Service-Name': 'main-admin-server',
                'X-User-Id': req.admin!.userId,
              },
            }
          );
        }
      } catch (emailError: any) {
        logger.error('Failed to resend invite email:', emailError);
      }
      
      await createAuditLog(
        req,
        'admin.invite.resend',
        'admin_invite',
        invite.inviteId,
        {}
      );
      
      res.json({
        success: true,
        message: 'Invite resent successfully',
      });
    } catch (error: any) {
      logger.error('Resend invite error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to resend invite',
      });
    }
  }
  
  /**
   * DELETE /api/v1/admin/invites/:inviteId
   * Cancel invite
   */
  static async cancelInvite(req: Request, res: Response): Promise<void> {
    try {
      const { inviteId } = req.params;
      
      const invite = await AdminInvite.findOne({ inviteId });
      if (!invite) {
        res.status(404).json({
          success: false,
          error: 'Invite not found',
        });
        return;
      }
      
      if (invite.status !== 'pending') {
        res.status(400).json({
          success: false,
          error: 'Can only cancel pending invites',
        });
        return;
      }
      
      invite.status = 'cancelled';
      await invite.save();
      
      await createAuditLog(
        req,
        'admin.invite.cancel',
        'admin_invite',
        invite.inviteId,
        {}
      );
      
      res.json({
        success: true,
        message: 'Invite cancelled',
      });
    } catch (error: any) {
      logger.error('Cancel invite error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel invite',
      });
    }
  }
  
  /**
   * POST /api/v1/admin/invites/:inviteId/accept
   * Accept invite (public endpoint, no auth required)
   */
  static async acceptInvite(req: Request, res: Response): Promise<void> {
    try {
      const { inviteId } = req.params;
      const { token, password, name } = req.body;
      
      if (!token || !password || !name) {
        res.status(400).json({
          success: false,
          error: 'Token, password, and name are required',
        });
        return;
      }
      
      const invite = await AdminInvite.findOne({ inviteId });
      if (!invite) {
        res.status(404).json({
          success: false,
          error: 'Invite not found',
        });
        return;
      }
      
      if (!invite.canBeAccepted()) {
        res.status(400).json({
          success: false,
          error: 'Invite is expired or already used',
        });
        return;
      }
      
      // Verify token
      const isValid = await invite.verifyToken(token);
      if (!isValid) {
        res.status(400).json({
          success: false,
          error: 'Invalid invite token',
        });
        return;
      }
      
      // Check if user already exists
      const existingUser = await AdminUser.findOne({ email: invite.email });
      if (existingUser) {
        res.status(400).json({
          success: false,
          error: 'User with this email already exists',
        });
        return;
      }
      
      // Create user
      const passwordHash = await bcrypt.hash(password, 10);
      
      // Get permissions
      const permissions = PermissionService.getRolePermissions(
        invite.dashboardType,
        invite.role
      );
      
      const user = new AdminUser({
        email: invite.email,
        passwordHash,
        name,
        dashboardAccess: [{
          dashboardType: invite.dashboardType,
          role: invite.role,
          status: 'active',
          permissions,
          grantedBy: invite.invitedBy,
          grantedAt: new Date(),
        }],
        status: 'active',
        joinedVia: 'invite',
        createdBy: invite.invitedBy,
      });
      
      await user.save();
      
      // Mark invite as accepted
      invite.status = 'accepted';
      invite.acceptedAt = new Date();
      invite.acceptedBy = user.userId;
      await invite.save();
      
      res.json({
        success: true,
        message: 'Invite accepted successfully',
        data: {
          userId: user.userId,
          email: user.email,
        },
      });
    } catch (error: any) {
      logger.error('Accept invite error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to accept invite',
      });
    }
  }
}
