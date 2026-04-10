import { Request, Response } from 'express';
import { AdminUser } from '../models/AdminUser';
import { PermissionService } from '../services/PermissionService';
import { DashboardType } from '../types/dashboard';
import logger from '../config/logger';
import { createAuditLog } from '../middleware/audit';
import bcrypt from 'bcrypt';

export class AdminUserController {
  /**
   * GET /api/v1/admin/users
   * List all admin users (Super Admin only)
   */
  static async listUsers(req: Request, res: Response): Promise<void> {
    try {
      const { page = 1, limit = 20, search, dashboardType, status } = req.query;
      
      const query: any = {};
      
      if (search) {
        query.$or = [
          { email: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } },
        ];
      }
      
      if (dashboardType) {
        query['dashboardAccess.dashboardType'] = dashboardType;
      }
      
      if (status) {
        query.status = status;
      }
      
      const skip = (Number(page) - 1) * Number(limit);
      
      const [users, total] = await Promise.all([
        AdminUser.find(query)
          .select('-passwordHash -refreshTokens -mfaSecret')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit)),
        AdminUser.countDocuments(query),
      ]);
      
      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      logger.error('List admin users error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list admin users',
      });
    }
  }
  
  /**
   * GET /api/v1/admin/users/:userId
   * Get admin user by ID
   */
  static async getUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      
      const user = await AdminUser.findOne({ userId })
        .select('-passwordHash -refreshTokens -mfaSecret');
      
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'Admin user not found',
        });
        return;
      }
      
      res.json({
        success: true,
        data: user,
      });
    } catch (error: any) {
      logger.error('Get admin user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get admin user',
      });
    }
  }
  
  /**
   * POST /api/v1/admin/users
   * Create admin user (Super Admin only)
   */
  static async createUser(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, name, dashboardType, role, isSuperAdmin } = req.body;
      
      if (!email || !name) {
        res.status(400).json({
          success: false,
          error: 'Email and name are required',
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
      
      // Hash password if provided
      let passwordHash: string | undefined;
      if (password) {
        passwordHash = await bcrypt.hash(password, 10);
      }
      
      // Get permissions for the role
      const permissions = dashboardType && role
        ? PermissionService.getRolePermissions(dashboardType, role)
        : [];
      
      const user = new AdminUser({
        email: email.toLowerCase(),
        passwordHash,
        name,
        isSuperAdmin: isSuperAdmin || false,
        status: 'active',
        dashboardAccess: dashboardType && role ? [{
          dashboardType,
          role,
          status: 'active',
          permissions,
          grantedBy: req.admin!.userId,
          grantedAt: new Date(),
        }] : [],
        createdBy: req.admin!.userId,
      });
      
      await user.save();
      
      await createAuditLog(
        req,
        'admin.user.create',
        'admin_user',
        user.userId,
        { email: user.email, dashboardType, role }
      );
      
      const userResponse: any = user.toObject();
      if ('passwordHash' in userResponse) delete userResponse.passwordHash;
      if ('refreshTokens' in userResponse) delete userResponse.refreshTokens;
      if ('mfaSecret' in userResponse) delete userResponse.mfaSecret;
      
      res.status(201).json({
        success: true,
        data: userResponse,
      });
    } catch (error: any) {
      logger.error('Create admin user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create admin user',
      });
    }
  }
  
  /**
   * PUT /api/v1/admin/users/:userId
   * Update admin user
   */
  static async updateUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { name, status, password } = req.body;
      
      const user = await AdminUser.findOne({ userId });
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'Admin user not found',
        });
        return;
      }
      
      // Prevent self-suspension
      if (status === 'suspended' && user.userId === req.admin!.userId) {
        res.status(400).json({
          success: false,
          error: 'Cannot suspend yourself',
        });
        return;
      }
      
      if (name) user.name = name;
      if (status) user.status = status as any;
      
      if (password) {
        user.passwordHash = await bcrypt.hash(password, 10);
      }
      
      user.lastModifiedBy = req.admin!.userId;
      await user.save();
      
      await createAuditLog(
        req,
        'admin.user.update',
        'admin_user',
        user.userId,
        { updates: req.body }
      );
      
      const userResponse: any = user.toObject();
      if ('passwordHash' in userResponse) delete userResponse.passwordHash;
      if ('refreshTokens' in userResponse) delete userResponse.refreshTokens;
      if ('mfaSecret' in userResponse) delete userResponse.mfaSecret;
      
      res.json({
        success: true,
        data: userResponse,
      });
    } catch (error: any) {
      logger.error('Update admin user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update admin user',
      });
    }
  }
  
  /**
   * POST /api/v1/admin/users/:userId/dashboard-access
   * Add dashboard access to admin user
   */
  static async addDashboardAccess(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { dashboardType, role } = req.body;
      
      if (!dashboardType || !role) {
        res.status(400).json({
          success: false,
          error: 'dashboardType and role are required',
        });
        return;
      }
      
      const user = await AdminUser.findOne({ userId });
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'Admin user not found',
        });
        return;
      }
      
      // Check if access already exists
      const existingAccess = user.dashboardAccess.find(
        (a) => a.dashboardType === dashboardType
      );
      
      if (existingAccess) {
        res.status(400).json({
          success: false,
          error: 'User already has access to this dashboard',
        });
        return;
      }
      
      // Get permissions for the role
      const permissions = PermissionService.getRolePermissions(dashboardType, role);
      
      user.dashboardAccess.push({
        dashboardType,
        role,
        status: 'active',
        permissions,
        grantedBy: req.admin!.userId,
        grantedAt: new Date(),
      });
      
      await user.save();
      
      await createAuditLog(
        req,
        'admin.user.dashboard-access.add',
        'admin_user',
        user.userId,
        { dashboardType, role }
      );
      
      res.json({
        success: true,
        data: user.dashboardAccess[user.dashboardAccess.length - 1],
      });
    } catch (error: any) {
      logger.error('Add dashboard access error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add dashboard access',
      });
    }
  }
  
  /**
   * DELETE /api/v1/admin/users/:userId/dashboard-access/:dashboardType
   * Remove dashboard access from admin user
   */
  static async removeDashboardAccess(req: Request, res: Response): Promise<void> {
    try {
      const { userId, dashboardType } = req.params;
      
      const user = await AdminUser.findOne({ userId });
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'Admin user not found',
        });
        return;
      }
      
      // Prevent removing own access
      if (user.userId === req.admin!.userId && dashboardType === req.admin!.dashboardType) {
        res.status(400).json({
          success: false,
          error: 'Cannot remove your own dashboard access',
        });
        return;
      }
      
      user.dashboardAccess = user.dashboardAccess.filter(
        (a) => a.dashboardType !== dashboardType
      );
      
      await user.save();
      
      await createAuditLog(
        req,
        'admin.user.dashboard-access.remove',
        'admin_user',
        user.userId,
        { dashboardType }
      );
      
      res.json({
        success: true,
        message: 'Dashboard access removed',
      });
    } catch (error: any) {
      logger.error('Remove dashboard access error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove dashboard access',
      });
    }
  }
}
