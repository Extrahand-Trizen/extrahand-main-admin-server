import { Request, Response } from 'express';
import { taskServiceClient } from '../services/TaskServiceClient';
import logger from '../config/logger';
import { createAuditLog } from '../middleware/audit';
import { Resource } from '../types/permissions';

function getClientSafeStatus(error: any): number {
  const upstreamStatus = Number(error?.response?.status || 0);
  // Prevent downstream service-auth 401 from forcing admin logout in web client.
  if (upstreamStatus === 401) {
    return 502;
  }
  return upstreamStatus || 500;
}

export class TaskManagementController {
  /**
   * GET /api/v1/tasks
   * List tasks
   */
  static async listTasks(req: Request, res: Response): Promise<void> {
    try {
      const params = {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        search: req.query.search as string,
        status: req.query.status as string,
        category: req.query.category as string,
        posterId: req.query.posterId as string,
        assigneeId: req.query.assigneeId as string,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
      };
      
      const result = await taskServiceClient.listTasks(params);
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('List tasks error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list tasks',
      });
    }
  }

  /**
   * GET /api/v1/applications
   * List applications (optionally scoped to a profile via X-Profile-Id)
   */
  static async listApplications(req: Request, res: Response): Promise<void> {
    try {
      const params = {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        status: req.query.status as string,
        taskId: req.query.taskId as string,
        mine: req.query.mine === 'true',
      };
      const profileId = req.query.profileId as string | undefined;

      const result = await taskServiceClient.listApplications(params, profileId);

      res.json({
        success: true,
        data: result.data || result,
        pagination: result.pagination,
      });
    } catch (error: any) {
      logger.error('List applications error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list applications',
      });
    }
  }
  
  /**
   * GET /api/v1/tasks/:taskId
   * Get task by ID
   */
  static async getTask(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      
      const result = await taskServiceClient.getTask(taskId);
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Get task error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get task',
      });
    }
  }
  
  /**
   * PATCH /api/v1/tasks/:taskId
   * Update task
   */
  static async updateTask(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      
      const result = await taskServiceClient.updateTask(taskId, req.body);
      
      await createAuditLog(
        req,
        `${Resource.TASK}.update`,
        Resource.TASK,
        taskId,
        { updates: req.body }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Update task error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update task',
      });
    }
  }
  
  /**
   * DELETE /api/v1/tasks/:taskId
   * Delete task
   */
  static async deleteTask(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      const { reason } = req.body;
      
      if (!reason) {
        res.status(400).json({
          success: false,
          error: 'Reason is required for deleting a task',
        });
        return;
      }
      
      const result = await taskServiceClient.deleteTask(taskId, reason);
      
      await createAuditLog(
        req,
        `${Resource.TASK}.delete`,
        Resource.TASK,
        taskId,
        { reason }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Delete task error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to delete task',
      });
    }
  }
  
  /**
   * GET /api/v1/tasks/:taskId/applications
   * Get task applications
   */
  static async getTaskApplications(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      
      const params = {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        status: req.query.status as string,
      };
      
      const result = await taskServiceClient.getTaskApplications(taskId, params);
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Get task applications error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get task applications',
      });
    }
  }
  
  /**
   * PATCH /api/v1/tasks/:taskId/applications/:applicationId
   * Update application status
   */
  static async updateApplicationStatus(req: Request, res: Response): Promise<void> {
    try {
      const { taskId, applicationId } = req.params;
      const { status } = req.body;
      
      if (!status) {
        res.status(400).json({
          success: false,
          error: 'Status is required',
        });
        return;
      }
      
      const result = await taskServiceClient.updateApplicationStatus(
        taskId,
        applicationId,
        status
      );
      
      await createAuditLog(
        req,
        `${Resource.TASK_APPLICATION}.update`,
        Resource.TASK_APPLICATION,
        applicationId,
        { status }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Update application status error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update application status',
      });
    }
  }
}
