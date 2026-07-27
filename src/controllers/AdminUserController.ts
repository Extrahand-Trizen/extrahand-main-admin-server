import { Request, Response } from 'express';
import { AdminUser } from '../models/AdminUser';
import { TaskAssignment } from '../models/TaskAssignment';
import { AadhaarKycAssignment } from '../models/AadhaarKycAssignment';
import { PermissionService } from '../services/PermissionService';
import { DashboardType } from '../types/dashboard';
import logger from '../config/logger';
import { createAuditLog } from '../middleware/audit';
import bcrypt from 'bcrypt';
import { TASK_POSTED_ROUND_ROBIN_EMAILS } from '../constants/taskAssignment';

export class AdminUserController {
  /**
   * GET /api/v1/admin/users
   * List all admin users (Super Admin only)
   */
  static async listUsers(req: Request, res: Response): Promise<void> {
    try {
      const { page = 1, limit = 20, search, dashboardType, status } = req.query;
      
      const query: any = {};
      
      // Only show active users by default, suspended users should not appear in the list
      query.status = status || 'active';
      
      if (search) {
        query.$or = [
          { email: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } },
        ];
      }
      
      if (dashboardType) {
        query['dashboardAccess.dashboardType'] = dashboardType;
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
      const { name, status, password, role, dashboardType, isSuperAdmin } = req.body;
      
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
      if (typeof isSuperAdmin === 'boolean') {
        user.isSuperAdmin = isSuperAdmin;
      }

      // Allow role shift (Super Admin only route already guards this controller).
      // If dashboardType is not provided, update the first dashboardAccess entry (if any).
      if (role) {
        const targetDashboardType: DashboardType | undefined = dashboardType;
        const access =
          targetDashboardType
            ? user.dashboardAccess.find((a) => a.dashboardType === targetDashboardType)
            : user.dashboardAccess[0];
        if (!access) {
          // Create an access record if missing and dashboardType provided.
          if (targetDashboardType) {
            const permissions = PermissionService.getRolePermissions(targetDashboardType, role);
            user.dashboardAccess.push({
              dashboardType: targetDashboardType,
              role,
              status: 'active',
              permissions,
              grantedBy: req.admin!.userId,
              grantedAt: new Date(),
            } as any);
          } else {
            res.status(400).json({
              success: false,
              error: 'User has no dashboard access to update. Provide dashboardType.',
            });
            return;
          }
        } else {
          access.role = role;
          access.permissions = PermissionService.getRolePermissions(access.dashboardType, role);
        }
      }
      
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
  /**
   * GET /api/v1/admin/users/:userId/assignments-summary
   * Returns count of task assignments and aadhaar follow-up assignments for a given admin user.
   * Used by the frontend to decide whether to show a transfer step before deletion.
   */
  static async getAssignmentsSummary(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      const user = await AdminUser.findOne({ userId }).lean();
      if (!user) {
        res.status(404).json({ success: false, error: 'Admin user not found' });
        return;
      }

      const [taskCount, aadhaarCount] = await Promise.all([
        TaskAssignment.countDocuments({ assignedToUserId: userId }),
        AadhaarKycAssignment.countDocuments({ assignedToUserId: userId }),
      ]);

      // Find remaining active operations admins (excluding this user) who can receive work
      // Limited to round-robin email list (durgamshiva and tadembharath)
      const OPS_ROLES = ['operations_admin', 'operation_admin', 'operations'];
      const allActiveOpsAdmins = await AdminUser.find({
        status: 'active',
        userId: { $ne: userId },
        email: { $in: TASK_POSTED_ROUND_ROBIN_EMAILS as any },
        'dashboardAccess': {
          $elemMatch: {
            dashboardType: DashboardType.MAIN_ADMIN,
            status: 'active',
            role: { $in: OPS_ROLES },
          },
        },
      })
        .select('userId name email')
        .lean();

      res.json({
        success: true,
        data: {
          taskAssignmentCount: taskCount,
          aadhaarAssignmentCount: aadhaarCount,
          totalAssignments: taskCount + aadhaarCount,
          hasAssignments: taskCount + aadhaarCount > 0,
          remainingActiveOpsAdmins: allActiveOpsAdmins.map((a) => ({
            userId: a.userId,
            name: a.name,
            email: a.email,
          })),
          canDelete: allActiveOpsAdmins.length > 0 || taskCount + aadhaarCount === 0,
        },
      });
    } catch (error: any) {
      logger.error('getAssignmentsSummary error:', error);
      res.status(500).json({ success: false, error: 'Failed to get assignment summary' });
    }
  }

  /**
   * POST /api/v1/admin/users/:userId/transfer-and-delete
   * Transfers all task assignments and aadhaar follow-up assignments equally
   * (round-robin) to remaining active operations admins, then deletes the admin user.
   * Super Admin only.
   */
  static async transferAndDeleteAdminUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      const user = await AdminUser.findOne({ userId });
      if (!user) {
        res.status(404).json({ success: false, error: 'Admin user not found' });
        return;
      }

      // Prevent self-deletion
      if (user.userId === req.admin!.userId) {
        res.status(400).json({ success: false, error: 'Cannot delete yourself' });
        return;
      }

      // Find remaining active operations admins (excluding this user)
      // Limited to round-robin email list (durgamshiva and tadembharath)
      const OPS_ROLES = ['operations_admin', 'operation_admin', 'operations'];
      const remainingAdmins = await AdminUser.find({
        status: 'active',
        userId: { $ne: userId },
        email: { $in: TASK_POSTED_ROUND_ROBIN_EMAILS as any },
        'dashboardAccess': {
          $elemMatch: {
            dashboardType: DashboardType.MAIN_ADMIN,
            status: 'active',
            role: { $in: OPS_ROLES },
          },
        },
      })
        .select('userId name email')
        .lean();

      // Fetch all task assignments and aadhaar assignments belonging to deleted user
      const [taskAssignments, aadhaarAssignments] = await Promise.all([
        TaskAssignment.find({ assignedToUserId: userId }).lean(),
        AadhaarKycAssignment.find({ assignedToUserId: userId }).lean(),
      ]);

      const totalAssignments = taskAssignments.length + aadhaarAssignments.length;

      // If there are assignments but no remaining admins, block deletion
      if (totalAssignments > 0 && remainingAdmins.length === 0) {
        res.status(400).json({
          success: false,
          error:
            'Cannot delete this admin user — there are no other active operations admins to transfer their assigned work to. Please add another operations admin first.',
        });
        return;
      }

      let transferredTasks = 0;
      let transferredAadhaar = 0;

      // Redistribute task assignments round-robin
      if (taskAssignments.length > 0 && remainingAdmins.length > 0) {
        const taskBulkOps = taskAssignments.map((assignment, index) => {
          const recipient = remainingAdmins[index % remainingAdmins.length];
          return {
            updateOne: {
              filter: { _id: assignment._id },
              update: {
                $set: {
                  assignedToUserId: recipient.userId,
                  assignedToEmail: recipient.email,
                  assignedToName: recipient.name,
                },
              },
            },
          };
        });
        await TaskAssignment.bulkWrite(taskBulkOps);
        transferredTasks = taskAssignments.length;
      }

      // Redistribute aadhaar KYC assignments round-robin
      if (aadhaarAssignments.length > 0 && remainingAdmins.length > 0) {
        const aadhaarBulkOps = aadhaarAssignments.map((assignment, index) => {
          const recipient = remainingAdmins[index % remainingAdmins.length];
          return {
            updateOne: {
              filter: { _id: assignment._id },
              update: {
                $set: {
                  assignedToUserId: recipient.userId,
                  assignedToEmail: recipient.email,
                  assignedToName: recipient.name,
                },
              },
            },
          };
        });
        await AadhaarKycAssignment.bulkWrite(aadhaarBulkOps);
        transferredAadhaar = aadhaarAssignments.length;
      }

      // Now delete the admin user
      await AdminUser.deleteOne({ userId });

      await createAuditLog(
        req,
        'admin.user.transfer-and-delete',
        'admin_user',
        userId,
        {
          email: user.email,
          transferredTasks,
          transferredAadhaar,
          redistributedTo: remainingAdmins.map((a) => a.email),
        },
      );

      res.json({
        success: true,
        message: 'Admin user deleted successfully after transferring assignments',
        data: {
          transferredTasks,
          transferredAadhaar,
          redistributedTo: remainingAdmins.map((a) => ({ userId: a.userId, name: a.name, email: a.email })),
        },
      });
    } catch (error: any) {
      logger.error('transferAndDeleteAdminUser error:', error);
      res.status(500).json({ success: false, error: 'Failed to transfer and delete admin user' });
    }
  }

  /**
   * DELETE /api/v1/admin/users/:userId
   * Delete admin user (Super Admin only)
   */
  static async deleteAdminUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      const user = await AdminUser.findOne({ userId });
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'Admin user not found',
        });
        return;
      }

      // Prevent self-deletion
      if (user.userId === req.admin!.userId) {
        res.status(400).json({
          success: false,
          error: 'Cannot delete yourself',
        });
        return;
      }

      await AdminUser.deleteOne({ userId });

      await createAuditLog(
        req,
        'admin.user.delete',
        'admin_user',
        userId,
        { email: user.email }
      );

      res.json({
        success: true,
        message: 'Admin user deleted successfully',
      });
    } catch (error: any) {
      logger.error('Delete admin user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete admin user',
      });
    }
  }
}
