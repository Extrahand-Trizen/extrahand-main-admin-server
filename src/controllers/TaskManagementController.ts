import { Request, Response } from 'express';
import { taskServiceClient } from '../services/TaskServiceClient';
import logger from '../config/logger';
import { createAuditLog } from '../middleware/audit';
import { Resource } from '../types/permissions';
import { getClientSafeStatus } from '../utils/upstreamHttp';
import { TaskDeleteRequest } from '../models/TaskDeleteRequest';
import { TaskCallRecord } from '../models/TaskCallRecord';
import { AdminNotification } from '../models/AdminNotification';
import { AdminUser } from '../models/AdminUser';
import { DashboardType } from '../types/dashboard';
import {
  normalizeAdminEmail,
  normalizeTaskIdForAssignment,
  resolveAssignedDisplayName,
} from '../constants/taskAssignment';
import { createTaskPostedAdminNotification } from './NotificationController';
import {
  loadTaskAssignmentMap,
  persistTaskAssignment,
  resolveAssigneeFilter,
  resolveAssigneeFilterUserId,
  taskMatchesAssigneeFilter,
} from '../services/TaskAssignmentService';
import { TaskAssignment } from '../models/TaskAssignment';
import { userServiceClient } from '../services/UserServiceClient';

type UpstreamPagination = {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  pages?: number;
};

function extractPagination(payload: any): { page: number; limit: number; total: number; pages: number } | undefined {
  const pagination: UpstreamPagination | undefined =
    payload?.pagination || payload?.meta?.pagination;

  if (!pagination) return undefined;

  const page = Number(pagination.page || 1);
  const limit = Number(pagination.limit || 20);
  const total = Number(pagination.total || 0);
  const pages = Number(pagination.pages || pagination.totalPages || 1);

  return { page, limit, total, pages };
}

function normalizeTask(task: any): any {
  const normalizedBudget =
    typeof task?.budget === 'number'
      ? task.budget
      : Number(task?.budget?.amount ?? task?.budgetValue ?? 0);

  return {
    ...task,
    taskId: normalizeTaskIdForAssignment(task?.taskId ?? task?._id ?? task?.id),
    CustomerId: task?.CustomerId || task?.requesterId,
    budget: Number.isFinite(normalizedBudget) ? normalizedBudget : 0,
  };
}

async function enrichTasksWithTaskCallStatus(tasks: any[]): Promise<any[]> {
  const taskIds = Array.from(
    new Set(
      tasks
        .map((task) => String(task?.taskId || '').trim())
        .filter(Boolean),
    ),
  );

  if (taskIds.length === 0) return tasks;

  const records = await TaskCallRecord.find({ taskId: { $in: taskIds } })
    .select('taskId status followUpDate updatedAt')
    .lean();
  const recordMap = new Map(records.map((record) => [record.taskId, record]));

  return tasks.map((task) => {
    const record = recordMap.get(String(task.taskId));
    return {
      ...task,
      taskCallStatus: record?.status || 'not_updated',
      taskCallFollowUpDate: record?.followUpDate || null,
      taskCallUpdatedAt: record?.updatedAt || null,
    };
  });
}

function extractTaskId(task: any): string {
  return normalizeTaskIdForAssignment(task?.taskId ?? task?._id ?? task?.id);
}

async function enrichTasksWithAssignedTo(tasks: any[]): Promise<any[]> {
  const taskIds = Array.from(new Set(tasks.map(extractTaskId).filter(Boolean)));
  let assignmentMap = await loadTaskAssignmentMap(taskIds);
  const missingTasks = tasks.filter((task) => {
    const tid = extractTaskId(task).toLowerCase();
    return tid && !assignmentMap.has(tid);
  });

  if (missingTasks.length > 0) {
    for (const task of missingTasks.slice(0, 50)) {
      const taskId = extractTaskId(task);
      const existingAssignment = await TaskAssignment.findOne({ taskId })
        .select('taskId')
        .lean();
      if (existingAssignment) continue;

      const existingNotification = await AdminNotification.findOne({
        type: 'task_posted',
        dashboardType: DashboardType.MAIN_ADMIN,
        'metadata.taskId': taskId,
      })
        .select('_id')
        .lean();
      if (existingNotification) continue;

      const result = await createTaskPostedAdminNotification({
        taskId,
        taskTitle: task.title,
        userId: task.CustomerId || task.customerId || task.requesterId,
        occurredAt: task.createdAt || new Date().toISOString(),
        assignedAt: new Date(),
      });

      if (result.assignedTo) {
        logger.info('[TaskPostedInAppNotification][main-admin-server] Repaired missing task assignment from task list', {
          taskId,
          taskTitle: task.title,
          assignedToEmail: result.assignedTo.email,
          assignedToName: result.assignedTo.name,
        });
      }
    }

    assignmentMap = await loadTaskAssignmentMap(taskIds);
  }

  return tasks.map((task) => {
    const tid = extractTaskId(task).toLowerCase();
    const assignee = assignmentMap.get(tid);
    return {
      ...task,
      assignedTo: assignee
        ? { userId: assignee.userId, name: assignee.name, email: assignee.email }
        : null,
    };
  });
}

async function enrichTasksWithAssigneeName(tasks: any[]): Promise<any[]> {
  const assigneeIds = Array.from(new Set(
    tasks.map((t) => t.assigneeId).filter(Boolean)
  ));
  if (assigneeIds.length === 0) return tasks;

  try {
    const result = await userServiceClient.getProfilesBatch(assigneeIds);
    const profiles = Array.isArray(result?.profiles) ? result.profiles : [];
    const profileMap = new Map(
      profiles.map((p: any) => [String(p._id || p.id), p.name || 'Unknown'])
    );
    return tasks.map((task) => ({
      ...task,
      assigneeName: task.assigneeId ? (profileMap.get(String(task.assigneeId)) ?? null) : null,
    }));
  } catch (error) {
    logger.warn('Failed to enrich tasks with assignee name', error);
    return tasks;
  }
}

async function fetchTasksForLocalFiltering(params: Record<string, any>): Promise<any[]> {
  const maxTasks = 1000;
  const upstreamLimit = 50;
  const tasks: any[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await taskServiceClient.listTasks({
      ...params,
      page,
      limit: upstreamLimit,
    });
    const rows = Array.isArray(result?.data)
      ? result.data.map(normalizeTask)
      : [];
    tasks.push(...rows);

    const pagination = extractPagination(result);
    totalPages = pagination?.pages || (rows.length === upstreamLimit ? page + 1 : page);
    page += 1;
  } while (page <= totalPages && tasks.length < maxTasks);

  return tasks.slice(0, maxTasks);
}

function extractProposedAmount(application: any): number | undefined {
  if (typeof application?.proposedAmount === 'number') {
    return application.proposedAmount;
  }
  if (typeof application?.proposed_amount === 'number') {
    return application.proposed_amount;
  }
  const budget = application?.proposedBudget;
  if (typeof budget === 'number') {
    return budget;
  }
  if (budget && typeof budget.amount === 'number') {
    return budget.amount;
  }
  return undefined;
}

function normalizeApplication(application: any): any {
  const proposedAmount = extractProposedAmount(application);
  return {
    ...application,
    applicationId:
      application?.applicationId || application?.id || application?._id,
    HelperId: application?.HelperId || application?.applicantId,
    proposedAmount,
    proposedBudget: application?.proposedBudget,
  };
}

export class TaskManagementController {
  /**
   * GET /api/v1/tasks
   * List tasks
   */
  static async listTasks(req: Request, res: Response): Promise<void> {
    try {
      const customerFilter =
        (req.query.customerId as string) || (req.query.CustomerId as string);
      const followUpStatus = String(req.query.followUpStatus || '').trim();
      const assignedToParam = String(req.query.assignedTo || '').trim();
      const requestedStatus = String(req.query.status || '').trim();
      const bookingSource = String(req.query.bookingSource || '').trim();
      const isOverdueFilter = requestedStatus === 'overdue';

      const assigneeFilter =
        assignedToParam && assignedToParam !== 'all'
          ? resolveAssigneeFilter(assignedToParam)
          : null;
      const assigneeFilterUserId = assigneeFilter
        ? await resolveAssigneeFilterUserId(assigneeFilter)
        : null;

      // For overdue, we query open tasks from task service and filter by deadline on our side
      // For open, we exclude overdue tasks (those with past scheduledDate and non-flexible dateOption)
      const upstreamStatus = isOverdueFilter ? 'open' : requestedStatus;

      const params = {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        search: req.query.search as string,
        status: upstreamStatus,
        excludeOverdue: requestedStatus === 'open' ? 'true' : undefined,
        category: req.query.category as string,
        CustomerId: customerFilter,
        assigneeId: req.query.assigneeId as string,
        // Pass bookingSource directly to task service so it filters at DB level
        // (bypasses the marketplace-only clause for book_now / posted_task)
        bookingSource: bookingSource && bookingSource !== 'all' ? bookingSource : undefined,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
      };

      // We need local filtering if: overdue filter, followUpStatus filter, or assignee filter
      // bookingSource is now handled upstream by the task service
      const needsLocalFilter =
        isOverdueFilter ||
        (followUpStatus && followUpStatus !== 'all') ||
        Boolean(assigneeFilter);

      if (needsLocalFilter) {
        const requestedPage = params.page || 1;
        const requestedLimit = params.limit || 20;

        // For overdue: fetch all open tasks (no page limit) to filter locally
        const fetchParams: Record<string, any> = {
          search: params.search,
          status: upstreamStatus,
          category: params.category,
          CustomerId: params.CustomerId,
          assigneeId: params.assigneeId,
          bookingSource: params.bookingSource,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
        };
        // Don't send excludeOverdue when fetching for overdue filter
        // (we want ALL open tasks including overdue ones, then filter locally)
        if (!isOverdueFilter && params.excludeOverdue) {
          fetchParams.excludeOverdue = params.excludeOverdue;
        }

        const allTasks = await fetchTasksForLocalFiltering(fetchParams);
        let enrichedTasks = await enrichTasksWithTaskCallStatus(allTasks);
        enrichedTasks = await enrichTasksWithAssignedTo(enrichedTasks);
        enrichedTasks = await enrichTasksWithAssigneeName(enrichedTasks);

        // Apply overdue filter: open tasks whose scheduledDate has passed (and not flexible)
        if (isOverdueFilter) {
          const now = new Date();
          enrichedTasks = enrichedTasks.filter((task) => {
            if (task.status !== 'open') return false;
            if (!task.scheduledDate) return false;
            if (task.dateOption === 'flexible') return false;
            return new Date(task.scheduledDate) < now;
          });
        }

        // When filtering by 'open' status, strip out tasks whose deadline has passed
        if (!isOverdueFilter && requestedStatus === 'open') {
          const now = new Date();
          enrichedTasks = enrichedTasks.filter((task) => {
            if (task.status !== 'open') return true;
            if (!task.scheduledDate) return true;
            if (task.dateOption === 'flexible') return true;
            return new Date(task.scheduledDate) >= now;
          });
        }

        // Apply followUpStatus filter
        if (followUpStatus && followUpStatus !== 'all') {
          enrichedTasks = enrichedTasks.filter(
            (task) => task.taskCallStatus === followUpStatus,
          );
        }

        if (assigneeFilter) {
          enrichedTasks = enrichedTasks.filter((task) =>
            taskMatchesAssigneeFilter(
              task.assignedTo,
              assigneeFilter,
              assigneeFilterUserId,
            ),
          );
        }

        const start = (requestedPage - 1) * requestedLimit;
        res.json({
          success: true,
          data: enrichedTasks.slice(start, start + requestedLimit),
          pagination: {
            page: requestedPage,
            limit: requestedLimit,
            total: enrichedTasks.length,
            pages: Math.max(1, Math.ceil(enrichedTasks.length / requestedLimit)),
          },
        });
        return;
      }
      
      const result = await taskServiceClient.listTasks(params);
      const tasks = Array.isArray(result?.data)
        ? result.data.map(normalizeTask)
        : [];
      let enrichedTasks = await enrichTasksWithTaskCallStatus(tasks);
      enrichedTasks = await enrichTasksWithAssignedTo(enrichedTasks);
      enrichedTasks = await enrichTasksWithAssigneeName(enrichedTasks);

      // When filtering by 'open', exclude tasks whose deadline has already passed
      // (overdue tasks should only appear when 'overdue' filter is selected)
      if (requestedStatus === 'open') {
        const now = new Date();
        enrichedTasks = enrichedTasks.filter((task) => {
          if (task.status !== 'open') return true; // keep non-open tasks unchanged
          if (!task.scheduledDate) return true; // no deadline = not overdue
          if (task.dateOption === 'flexible') return true; // flexible = not overdue
          return new Date(task.scheduledDate) >= now; // keep only future deadlines
        });
      }

      const pagination = extractPagination(result);
      
      res.json({
        success: true,
        data: enrichedTasks,
        ...(pagination ? { pagination } : {}),
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
      const applications = Array.isArray(result?.data)
        ? result.data.map(normalizeApplication)
        : [];
      const pagination = extractPagination(result);

      res.json({
        success: true,
        data: applications,
        ...(pagination ? { pagination } : {}),
      });
    } catch (error: any) {
      logger.error('List applications error:', error);
      res.status(getClientSafeStatus(error)).json({
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
      const normalizedTask = result?.data ? normalizeTask(result.data) : normalizeTask(result);
      let [enrichedTask] = await enrichTasksWithTaskCallStatus([normalizedTask]);
      [enrichedTask] = await enrichTasksWithAssignedTo([enrichedTask]);
      [enrichedTask] = await enrichTasksWithAssigneeName([enrichedTask]);
      
      res.json({
        success: true,
        data: enrichedTask,
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
      if (!req.admin?.isSuperAdmin) {
        res.status(403).json({
          success: false,
          error: 'Only Super Admin can delete tasks. Please raise a delete request.',
        });
        return;
      }

      const { taskId } = req.params;
      const { reason } = req.body;
      
      if (!reason?.trim()) {
        res.status(400).json({
          success: false,
          error: 'Reason is required for deleting a task',
        });
        return;
      }

      const taskPayload = await taskServiceClient.getTask(taskId);
      const rawTask = taskPayload?.data ?? taskPayload;
      const requesterProfileId = String(
        rawTask?.CustomerId || rawTask?.requesterId || '',
      ).trim();
      if (!rawTask || !requesterProfileId) {
        res.status(404).json({
          success: false,
          error: 'Task not found or missing requester for delete',
        });
        return;
      }

      const result = await taskServiceClient.deleteTask(taskId, reason.trim(), {
        requesterProfileId,
      });
      
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
      
      // Use applications listing endpoint for admin view. It does not require
      // requester/Helper profile context and supports paging for all applications.
      const result = await taskServiceClient.listApplications({
        taskId,
        status: params.status,
        page: params.page,
        limit: params.limit,
      });
      const applications = Array.isArray(result?.data)
        ? result.data.map(normalizeApplication)
        : [];
      const pagination = extractPagination(result);
      
      res.json({
        success: true,
        data: applications,
        ...(pagination ? { pagination } : {}),
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

  /**
   * POST /api/v1/tasks/:taskId/assign
   * Assign a helper to a Book Now task.
   */
  static async unassignHelper(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      const { escrowId } = req.body;
      const adminUserId = (req.admin as any)?.userId;

      const result = await taskServiceClient.unassignHelper({ taskId, escrowId }, adminUserId);

      await createAuditLog(
        req,
        `${Resource.TASK}.assign_helper`,
        Resource.TASK,
        taskId,
        { action: 'unassigned', escrowId }
      );

      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Unassign helper error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to unassign helper',
      });
    }
  }

  static async assignHelper(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      const { helperUid, helperProfileId, helperName } = req.body;
      const adminUserId = (req.admin as any)?.userId;

      if (!helperUid || !helperProfileId) {
        res.status(400).json({ success: false, error: 'helperUid and helperProfileId are required' });
        return;
      }

      // Resolve booking order info for this task
      let bookingInfo;
      try {
        bookingInfo = await taskServiceClient.getBookingByTaskId(taskId);
      } catch (err: any) {
        logger.info(`Booking info not found for task ${taskId}: ${err.message}. Using direct assignment fallback.`);
      }

      if (bookingInfo?.success && bookingInfo?.data) {
        const { orderId, bookingItemId } = bookingInfo.data;

        const result = await taskServiceClient.assignHelper({
          orderId,
          helperUid,
          helperProfileId,
          helperName,
          bookingItemId: bookingItemId || undefined,
        }, adminUserId);

        await createAuditLog(
          req,
          `${Resource.TASK}.assign_helper`,
          Resource.TASK,
          taskId,
          { helperUid, helperProfileId, orderId }
        );

        res.json({
          success: true,
          data: result.data || result,
        });
      } else {
        logger.info(`Using direct helper assignment fallback for task ${taskId}`);
        const result = await taskServiceClient.assignHelperDirect({
          taskId,
          helperUid,
          helperProfileId,
          helperName,
        }, adminUserId);

        await createAuditLog(
          req,
          `${Resource.TASK}.assign_helper_direct`,
          Resource.TASK,
          taskId,
          { helperUid, helperProfileId }
        );

        res.json({
          success: true,
          data: result.data || result,
        });
      }
    } catch (error: any) {
      logger.error('Assign helper error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to assign helper',
      });
    }
  }

  /**
   * POST /api/v1/tasks/:taskId/delete-requests
   * Operations creates a delete request for Super Admin approval.
   */
  static async createDeleteRequest(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      const { reason } = req.body;

      if (!taskId) {
        res.status(400).json({ success: false, error: 'taskId is required' });
        return;
      }

      if (!reason || !String(reason).trim()) {
        res.status(400).json({ success: false, error: 'Reason is required' });
        return;
      }

      if (!req.admin) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      if (req.admin.isSuperAdmin) {
        res.status(400).json({ success: false, error: 'Super Admin can delete directly' });
        return;
      }

      const existing = await TaskDeleteRequest.findOne({
        taskId,
        status: 'pending',
      });
      if (existing) {
        res.status(409).json({
          success: false,
          error: 'A pending delete request already exists for this task',
        });
        return;
      }

      const requestDoc = await TaskDeleteRequest.create({
        taskId,
        reason: String(reason).trim(),
        requestedBy: {
          userId: req.admin.userId,
          email: req.admin.email,
          name: req.admin.name,
        },
        requestedAt: new Date(),
      });

      await createAuditLog(
        req,
        `${Resource.TASK}.delete_request`,
        Resource.TASK,
        taskId,
        { reason: String(reason).trim(), requestId: requestDoc.requestId },
      );

      res.status(201).json({
        success: true,
        data: { requestId: requestDoc.requestId },
      });
    } catch (error: any) {
      logger.error('Create task delete request error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create delete request',
      });
    }
  }

  /**
   * GET /api/v1/tasks/delete-requests
   * Super Admin lists delete requests.
   */
  static async listDeleteRequests(req: Request, res: Response): Promise<void> {
    try {
      const { status = 'pending', page = 1, limit = 20, search } = req.query as any;

      const query: any = {};
      if (status && status !== 'all') query.status = status;
      if (search) {
        query.$or = [
          { taskId: { $regex: search, $options: 'i' } },
          { 'requestedBy.email': { $regex: search, $options: 'i' } },
          { 'requestedBy.name': { $regex: search, $options: 'i' } },
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);
      const [rows, total] = await Promise.all([
        TaskDeleteRequest.find(query).sort({ requestedAt: -1 }).skip(skip).limit(Number(limit)),
        TaskDeleteRequest.countDocuments(query),
      ]);

      res.json({
        success: true,
        data: {
          requests: rows,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      logger.error('List task delete requests error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list delete requests',
      });
    }
  }

  /**
   * POST /api/v1/tasks/delete-requests/:requestId/approve
   * Super Admin approves a delete request and deletes the task.
   */
  static async approveDeleteRequest(req: Request, res: Response): Promise<void> {
    try {
      const { requestId } = req.params;
      const { decisionNote } = req.body || {};

      const requestDoc = await TaskDeleteRequest.findOne({ requestId });
      if (!requestDoc) {
        res.status(404).json({ success: false, error: 'Delete request not found' });
        return;
      }
      if (requestDoc.status !== 'pending') {
        res.status(400).json({ success: false, error: 'Delete request already decided' });
        return;
      }

      // Perform the delete using the existing deleteTask logic requirements.
      // We must impersonate requester profile so task-service authZ passes.
      const taskPayload = await taskServiceClient.getTask(requestDoc.taskId);
      const rawTask = taskPayload?.data ?? taskPayload;
      const requesterProfileId = String(rawTask?.CustomerId || rawTask?.requesterId || '').trim();
      if (!requesterProfileId) {
        res.status(400).json({ success: false, error: 'Task requester profile missing; cannot delete' });
        return;
      }

      await taskServiceClient.deleteTask(requestDoc.taskId, requestDoc.reason, {
        requesterProfileId,
      });

      requestDoc.status = 'approved';
      requestDoc.decidedBy = {
        userId: req.admin!.userId,
        email: req.admin!.email,
        name: req.admin!.name,
      };
      requestDoc.decidedAt = new Date();
      if (decisionNote) requestDoc.decisionNote = String(decisionNote).trim();
      await requestDoc.save();

      await createAuditLog(
        req,
        `${Resource.TASK}.delete_request.approve`,
        Resource.TASK,
        requestDoc.taskId,
        { requestId, decisionNote: requestDoc.decisionNote },
      );

      res.json({ success: true, data: { requestId, status: requestDoc.status } });
    } catch (error: any) {
      logger.error('Approve task delete request error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to approve delete request',
      });
    }
  }

  /**
   * POST /api/v1/tasks/delete-requests/:requestId/reject
   * Super Admin rejects a delete request.
   */
  static async rejectDeleteRequest(req: Request, res: Response): Promise<void> {
    try {
      const { requestId } = req.params;
      const { decisionNote } = req.body || {};

      const requestDoc = await TaskDeleteRequest.findOne({ requestId });
      if (!requestDoc) {
        res.status(404).json({ success: false, error: 'Delete request not found' });
        return;
      }
      if (requestDoc.status !== 'pending') {
        res.status(400).json({ success: false, error: 'Delete request already decided' });
        return;
      }

      requestDoc.status = 'rejected';
      requestDoc.decidedBy = {
        userId: req.admin!.userId,
        email: req.admin!.email,
        name: req.admin!.name,
      };
      requestDoc.decidedAt = new Date();
      if (decisionNote) requestDoc.decisionNote = String(decisionNote).trim();
      await requestDoc.save();

      await createAuditLog(
        req,
        `${Resource.TASK}.delete_request.reject`,
        Resource.TASK,
        requestDoc.taskId,
        { requestId, decisionNote: requestDoc.decisionNote },
      );

      res.json({ success: true, data: { requestId, status: requestDoc.status } });
    } catch (error: any) {
      logger.error('Reject task delete request error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reject delete request',
      });
    }
  }

  /**
   * GET /api/v1/tasks/assignments/status
   * Super Admin: diagnose task assignment + notification pipeline.
   */
  static async getAssignmentStatus(req: Request, res: Response): Promise<void> {
    try {
      const { listTaskPostedRecipients } = await import(
        '../services/TaskPostedRecipientService'
      );
      const { TaskAssignment } = await import('../models/TaskAssignment');
      const { NotificationSequence } = await import('../models/NotificationSequence');

      const activeRecipients = await listTaskPostedRecipients();
      const [notificationCount, assignmentCount, latestNotifications, sequence] =
        await Promise.all([
          AdminNotification.countDocuments({ type: 'task_posted' }),
          TaskAssignment.countDocuments({}),
          AdminNotification.find({ type: 'task_posted' })
            .sort({ createdAt: -1 })
            .limit(3)
            .select('createdAt metadata.taskId targetAdminUserIds metadata.assignedToName')
            .lean(),
          NotificationSequence.findOne({
            key: 'task_posted_operations_round_robin',
          }).lean(),
        ]);

      const opsAdmins = await AdminUser.find({
        email: {
          $in: [
            'santhoshu@cognitbotz.com',
            'durgamshiva@cognitbotz.com',
            'tadembharat@cognitbotz.com',
          ],
        },
      })
        .select('userId email status dashboardAccess')
        .lean();

      res.json({
        success: true,
        data: {
          roundRobinReady: activeRecipients.length > 0,
          activeRecipients,
          notificationCount,
          assignmentCount,
          roundRobinSequence: sequence?.value ?? 0,
          latestNotifications,
          opsAdmins,
          collections: {
            inAppNotifications: 'adminnotifications',
            taskAssignments: 'task_assignments',
            adminUsers: 'admin_users',
            roundRobin: 'notificationsequences',
          },
        },
      });
    } catch (error: any) {
      logger.error('Assignment status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load assignment status',
      });
    }
  }

  /**
   * POST /api/v1/tasks/assignments/backfill
   * Super Admin: create missing task_posted notifications for open tasks (round-robin).
   */
  static async backfillTaskAssignments(req: Request, res: Response): Promise<void> {
    try {
      const allTasks = await fetchTasksForLocalFiltering({ status: 'open' });
      const taskIds = allTasks.map(extractTaskId).filter(Boolean);

      if (taskIds.length === 0) {
        res.json({ success: true, data: { created: 0, skipped: 0, total: 0 } });
        return;
      }

      const existingNotifications = await AdminNotification.find({
        type: 'task_posted',
        dashboardType: DashboardType.MAIN_ADMIN,
      })
        .select('metadata targetAdminUserIds')
        .lean();

      const wantedTaskIds = new Set(taskIds.map((id) => id.toLowerCase()));
      const existingTaskIds = new Set<string>();
      let patched = 0;

      for (const row of existingNotifications) {
        const tid = normalizeTaskIdForAssignment(row.metadata?.taskId).toLowerCase();
        if (!tid || !wantedTaskIds.has(tid)) continue;
        existingTaskIds.add(tid);

        const meta = row.metadata as Record<string, unknown> | undefined;
        if (meta?.assignedToEmail && meta?.assignedToName) continue;

        const assigneeUserId = row.targetAdminUserIds?.[0];
        if (!assigneeUserId) continue;

        const admin = await AdminUser.findOne({ userId: assigneeUserId })
          .select('userId email name')
          .lean();
        if (!admin) continue;

        const email = normalizeAdminEmail(admin.email);
        const normalizedTaskId = normalizeTaskIdForAssignment(meta?.taskId);
        const displayName = resolveAssignedDisplayName(email, admin.name);

        await AdminNotification.updateOne(
          { _id: row._id },
          {
            $set: {
              'metadata.taskId': normalizedTaskId,
              'metadata.assignedToUserId': admin.userId,
              'metadata.assignedToEmail': email,
              'metadata.assignedToName': displayName,
            },
          },
        );

        await persistTaskAssignment({
          taskId: normalizedTaskId,
          taskTitle: String(meta?.taskTitle || ''),
          recipient: { userId: admin.userId, email, name: displayName },
          notificationId: String(row._id),
        });
        patched += 1;
      }

      let created = 0;
      let skipped = 0;

      for (const task of allTasks) {
        const taskId = extractTaskId(task);
        const taskKey = taskId.toLowerCase();
        if (!taskId || existingTaskIds.has(taskKey)) continue;

        const result = await createTaskPostedAdminNotification({
          taskId,
          taskTitle: task.title,
          occurredAt: task.createdAt || new Date().toISOString(),
        });

        if (result.created) {
          created += 1;
          existingTaskIds.add(taskKey);
        } else {
          skipped += 1;
        }
      }

      res.json({
        success: true,
        data: { created, patched, skipped, total: allTasks.length },
      });
    } catch (error: any) {
      logger.error('Backfill task assignments error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to backfill task assignments',
      });
    }
  }

  /**
   * GET /api/v1/tasks/recycle-bin
   * Super Admin: list soft-deleted tasks.
   */
  static async listDeletedTasks(req: Request, res: Response): Promise<void> {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const search = (req.query.search as string) || undefined;

      const result = await taskServiceClient.listDeletedTasks({ page, limit, search });
      const tasks = Array.isArray(result?.data) ? result.data.map(normalizeTask) : [];
      const pagination = extractPagination(result);

      res.json({
        success: true,
        data: tasks,
        ...(pagination ? { pagination } : {}),
      });
    } catch (error: any) {
      logger.error('List deleted tasks error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list deleted tasks',
      });
    }
  }

  /**
   * POST /api/v1/tasks/:taskId/restore
   * Super Admin: restore a soft-deleted task.
   */
  static async restoreTask(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;

      const taskPayload = await taskServiceClient.getTask(taskId);
      const rawTask = taskPayload?.data ?? taskPayload;
      const requesterProfileId = String(rawTask?.CustomerId || rawTask?.requesterId || '').trim();
      if (!requesterProfileId) {
        res.status(404).json({ success: false, error: 'Task not found or missing requester for restore' });
        return;
      }

      const result = await taskServiceClient.restoreTask(taskId, { requesterProfileId });

      await createAuditLog(
        req,
        `${Resource.TASK}.restore`,
        Resource.TASK,
        taskId,
        {},
      );

      res.json({ success: true, data: result?.data ?? result });
    } catch (error: any) {
      logger.error('Restore task error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to restore task',
      });
    }
  }

  /**
   * DELETE /api/v1/tasks/:taskId/permanent
   * Super Admin: permanently delete a soft-deleted task.
   */
  static async permanentlyDeleteTask(req: Request, res: Response): Promise<void> {
    try {
      if (!req.admin?.isSuperAdmin) {
        res.status(403).json({
          success: false,
          error: 'Only Super Admin can permanently delete tasks.',
        });
        return;
      }

      const { taskId } = req.params;
      const reason = typeof req.body?.reason === 'string' ? String(req.body.reason).trim() : '';

      const taskPayload = await taskServiceClient.getTask(taskId);
      const rawTask = taskPayload?.data ?? taskPayload;
      const requesterProfileId = String(rawTask?.CustomerId || rawTask?.requesterId || '').trim();
      if (!requesterProfileId) {
        res.status(404).json({
          success: false,
          error: 'Task not found or missing requester for permanent delete',
        });
        return;
      }

      const result = await taskServiceClient.permanentlyDeleteTask(taskId, {
        requesterProfileId,
      });

      await createAuditLog(
        req,
        `${Resource.TASK}.permanent_delete`,
        Resource.TASK,
        taskId,
        reason ? { reason } : {},
      );

      res.json({
        success: true,
        data: result?.data ?? result,
      });
    } catch (error: any) {
      logger.error('Permanent delete task error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to permanently delete task',
      });
    }
  }
}
