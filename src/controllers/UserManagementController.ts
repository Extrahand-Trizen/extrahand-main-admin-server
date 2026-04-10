import { Request, Response } from 'express';
import { userServiceClient } from '../services/UserServiceClient';
import logger from '../config/logger';
import { createAuditLog } from '../middleware/audit';
import { Resource } from '../types/permissions';

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
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
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
      });
    } catch (error: any) {
      logger.error('List users error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list users',
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
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Get user error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get user',
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
      res.status(error.response?.status || 500).json({
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
      res.status(error.response?.status || 500).json({
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
      res.status(error.response?.status || 500).json({
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
      res.status(error.response?.status || 500).json({
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
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to unsuspend user',
      });
    }
  }
}
