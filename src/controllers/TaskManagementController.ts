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
import { BookingOrder } from '../models/BookingOrder';
import { userServiceClient } from '../services/UserServiceClient';
import { sendTaskPostedEmail } from '../services/TaskPostedEmailService';
import { getTaskPostedEmailSettings, isPhoneExcluded } from '../services/TaskPostedEmailSettingsService';
import { TaskPostedEmailAttempt } from '../models/TaskPostedEmailAttempt';
import { Task } from '../models/Task';
import { Profile } from '../models/Profile';
import mongoose from 'mongoose';

const TASKS_CACHE_TTL_MS = 30_000; // 30 seconds
let tasksCache: { tasks: any[]; expiresAt: number } | null = null;
let buildTasksPromise: Promise<any[]> | null = null;
let tasksCacheVersion = 0;


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
  const rawBudget = task?.budget;
  const normalizedBudget =
    typeof rawBudget === 'number'
      ? rawBudget
      : Number(rawBudget?.amount ?? task?.budgetValue ?? 0);
  // Preserve budget type ('hourly' | 'fixed') for payment-type filtering
  const budgetType: string =
    typeof rawBudget === 'object' && rawBudget !== null
      ? (rawBudget.type as string) || 'fixed'
      : 'fixed';
  const persistedAssigneeId =
    task?.assigneeId || task?.assigneeUid || task?.partnerId || task?.partnerUid || null;
  const persistedAssigneeName =
    task?.assignedHelperName || task?.assigneeName || task?.assignedToName || null;

  return {
    ...task,
    taskId: normalizeTaskIdForAssignment(task?.taskId ?? task?._id ?? task?.id),
    CustomerId: task?.CustomerId || task?.requesterId,
    budget: Number.isFinite(normalizedBudget) ? normalizedBudget : 0,
    budgetType,
    assigneeId: persistedAssigneeId,
    assigneeName: persistedAssigneeName,
    assignedHelperName: persistedAssigneeName,
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

      const existingNotification = await AdminNotification.findOne({
        type: 'task_posted',
        dashboardType: DashboardType.MAIN_ADMIN,
        'metadata.taskId': taskId,
      })
        .select('_id metadata')
        .lean();
      if (existingNotification) {
        if (!(existingNotification.metadata as any)?.taskPostedEmailSentAt) {
          const requesterId = normalizeTaskIdForAssignment(
            task.CustomerId || task.customerId || task.requesterId,
          );
          let customerName: string | undefined;
          if (requesterId) {
            try {
              const profileBatch = await userServiceClient.getProfilesBatch([requesterId]);
              const profile = Array.isArray(profileBatch?.profiles)
                ? profileBatch.profiles[0]
                : undefined;
              customerName = profile?.name || profile?.fullName;
            } catch (profileError: any) {
              logger.warn('[TaskPostedEmail][main-admin-server] Customer profile lookup failed during retry', {
                taskId,
                requesterId,
                error: profileError?.message || String(profileError),
              });
            }
          }
          const emailSent = await sendTaskPostedEmail({
            taskId,
            taskTitle: task.title,
            userName: customerName || task.userName || task.customerName || task.requesterName,
          });
          if (emailSent) {
            await AdminNotification.updateOne(
              { _id: existingNotification._id },
              { $set: { 'metadata.taskPostedEmailSentAt': new Date() } },
            );
            logger.info('[TaskPostedEmail][main-admin-server] Repaired missing work-posted email', {
              taskId,
              taskTitle: task.title,
            });
          }
        }
        continue;
      }
      if (existingAssignment) continue;

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

export function isHourlyTask(task: any): boolean {
  const slug = String(task?.categorySlug || '').trim().toLowerCase();
  const cat = String(task?.category || '').trim().toLowerCase();
  const label = String(task?.categoryLabel || '').trim().toLowerCase();
  const title = String(task?.title || '').trim().toLowerCase();
  const bType = String(task?.budgetType || task?.budget?.type || '').trim().toLowerCase();
  const hourlyFlag = Boolean(task?.hourlyHelper);
  return (
    slug === 'hourly-helper' ||
    slug === 'hourly-based' ||
    cat === 'hourly-helper' ||
    cat === 'hourly-based' ||
    label === 'hourly based' ||
    label === 'hourly helper' ||
    title.startsWith('helper ·') ||
    title.startsWith('helper -') ||
    title.includes('helper') ||
    bType === 'hourly' ||
    hourlyFlag
  );
}

async function enrichTasksWithPaymentInfo(tasks: any[]): Promise<any[]> {
  const orderIds = Array.from(
    new Set(
      tasks
        .map((t) => String(t?.bookingOrderId || '').trim())
        .filter(Boolean),
    ),
  );

  let orderMap = new Map<string, any>();
  if (orderIds.length > 0) {
    try {
      const orders = await BookingOrder.find({ orderId: { $in: orderIds } })
        .select('orderId total totalAfterCoupon couponCode couponDiscount')
        .lean();
      orderMap = new Map(orders.map((o: any) => [String(o.orderId), o]));
    } catch (err) {
      logger.warn('Failed to load booking orders for payment enrichment:', err);
    }
  }

  return tasks.map((task) => {
    const isHourly = isHourlyTask(task);
    const orderId = task?.bookingOrderId ? String(task.bookingOrderId) : null;
    const order = orderId ? orderMap.get(orderId) : null;

    let paymentAmount: number;
    let isFreeCoupon = false;

    if (order) {
      const effectiveTotal =
        typeof order.totalAfterCoupon === 'number'
          ? order.totalAfterCoupon
          : Number(order.total ?? 0);
      paymentAmount = Number.isFinite(effectiveTotal) ? effectiveTotal : 0;

      // "it should check the payment amount for that task if it is 0 it will comes under the free coupon for hourly based only"
      if (isHourly && (paymentAmount === 0 || order.total === 0)) {
        isFreeCoupon = true;
        paymentAmount = 0;
      }
    } else {
      paymentAmount = Number(task?.budget ?? 0);
    }

    return {
      ...task,
      isHourly,
      paymentAmount,
      isFreeCoupon,
      couponCode: order?.couponCode || null,
      couponDiscount: order?.couponDiscount || null,
      paymentType: isFreeCoupon ? 'free_coupon' : 'paid',
    };
  });
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
  public static invalidateCache(): void {
    tasksCacheVersion += 1;
    tasksCache = null;
    buildTasksPromise = null;
    logger.debug('TaskManagementController: tasks cache invalidated');
  }

  public static warmCache(): void {
    TaskManagementController.getCompiledTasks()
      .then((tasks) => {
        logger.info(`✅ TaskManagementController: cache warmed with ${tasks.length} tasks`);
      })
      .catch((err) => {
        logger.warn('TaskManagementController: failed to warm cache on startup', err);
      });
  }

  public static async buildCompiledTasks(): Promise<any[]> {
    try {
      const rawTasks = await Task.find(
        { isDeletedByCustomer: { $ne: true }, isDeletedBySupport: { $ne: true } },
        {
          taskId: 1,
          title: 1,
          description: 1,
          status: 1,
          category: 1,
          categorySlug: 1,
          categoryLabel: 1,
          budget: 1,
          budgetValue: 1,
          budgetType: 1,
          scheduledDate: 1,
          scheduledTimeStart: 1,
          scheduledTimeEnd: 1,
          dateOption: 1,
          createdAt: 1,
          updatedAt: 1,
          requesterId: 1,
          CustomerId: 1,
          customerId: 1,
          assigneeId: 1,
          assigneeUid: 1,
          partnerId: 1,
          partnerUid: 1,
          assignedHelperName: 1,
          assigneeName: 1,
          assignedToName: 1,
          bookingSource: 1,
          bookingOrderId: 1,
          hourlyHelper: 1,
          location: 1,
          address: 1,
          isDeletedByCustomer: 1,
          isDeletedBySupport: 1,
        }
      )
        .sort({ scheduledDate: -1, createdAt: -1 })
        .lean();

      const taskIds = rawTasks
        .map((t: any) => String(t.taskId || t._id || t.id || '').trim())
        .filter(Boolean);
      const requesterIds = rawTasks
        .map((t: any) => String(t.CustomerId || t.customerId || t.requesterId || '').trim())
        .filter(Boolean);
      const assigneeIds = rawTasks
        .map((t: any) => String(t.assigneeId || t.assigneeUid || t.partnerId || t.partnerUid || '').trim())
        .filter(Boolean);
      const orderIds = rawTasks
        .map((t: any) => String(t.bookingOrderId || '').trim())
        .filter(Boolean);

      const userIds = Array.from(new Set([...requesterIds, ...assigneeIds])).filter(Boolean);
      const validObjectIds = userIds
        .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const [assignments, taskCalls, orders, profiles, settings] = await Promise.all([
        TaskAssignment.find({ taskId: { $in: taskIds } }).lean(),
        TaskCallRecord.find({ taskId: { $in: taskIds } })
          .select('taskId status followUpDate updatedAt')
          .lean(),
        orderIds.length > 0
          ? BookingOrder.find({ orderId: { $in: orderIds } })
              .select('orderId total totalAfterCoupon couponCode couponDiscount')
              .lean()
          : Promise.resolve([]),
        userIds.length > 0
          ? Profile.find({
              $or: [
                { uid: { $in: userIds } },
                { _id: { $in: validObjectIds } },
              ],
            })
              .select('uid name email phone')
              .lean()
          : Promise.resolve([]),
        getTaskPostedEmailSettings(),
      ]);

      const assignmentMap = new Map<string, any>();
      for (const a of assignments) {
        if (a.taskId) {
          assignmentMap.set(String(a.taskId).toLowerCase(), a);
        }
      }

      const callMap = new Map<string, any>();
      for (const c of taskCalls) {
        if (c.taskId) {
          callMap.set(String(c.taskId), c);
        }
      }

      const orderMap = new Map<string, any>();
      for (const o of orders) {
        if (o.orderId) {
          orderMap.set(String(o.orderId), o);
        }
      }

      const profileMap = new Map<string, any>();
      for (const p of profiles) {
        if (p.uid) profileMap.set(String(p.uid), p);
        if ((p as any)._id) profileMap.set(String((p as any)._id), p);
      }

      const excludedPhones = settings?.excludedPhones || [];

      return rawTasks.map((t: any) => {
        const taskId = String(t.taskId || t._id || t.id || '');
        const requesterId = String(t.CustomerId || t.customerId || t.requesterId || '');
        const assigneeId = String(t.assigneeId || t.assigneeUid || t.partnerId || t.partnerUid || '');

        const customerProfile = requesterId ? profileMap.get(requesterId) : null;
        const helperProfile = assigneeId ? profileMap.get(assigneeId) : null;

        const assignment = assignmentMap.get(taskId.toLowerCase());
        const callRecord = callMap.get(taskId);
        const order = t.bookingOrderId ? orderMap.get(String(t.bookingOrderId)) : null;

        const customerPhone = customerProfile?.phone || '';
        const isTeamPosted = isPhoneExcluded(customerPhone, excludedPhones);

        const isHourly = isHourlyTask(t);
        let paymentAmount = typeof t.budget === 'number' ? t.budget : Number(t.budget?.amount ?? t.budgetValue ?? 0);
        let isFreeCoupon = false;

        if (order) {
          const effectiveTotal =
            typeof order.totalAfterCoupon === 'number'
              ? order.totalAfterCoupon
              : Number(order.total ?? 0);
          paymentAmount = Number.isFinite(effectiveTotal) ? effectiveTotal : 0;
          if (isHourly && (paymentAmount === 0 || order.total === 0)) {
            isFreeCoupon = true;
            paymentAmount = 0;
          }
        }

        const rawBudget = t?.budget;
        const normalizedBudget =
          typeof rawBudget === 'number'
            ? rawBudget
            : Number(rawBudget?.amount ?? t?.budgetValue ?? 0);
        const budgetType: string =
          typeof rawBudget === 'object' && rawBudget !== null
            ? (rawBudget.type as string) || 'fixed'
            : (t.budgetType || 'fixed');

        const resolvedAssigneeName = helperProfile?.name || t.assignedHelperName || t.assigneeName || t.assignedToName || null;

        return {
          ...t,
          taskId,
          CustomerId: requesterId,
          customerId: requesterId,
          customerName: customerProfile?.name || 'Customer',
          customerPhone: customerProfile?.phone || '',
          customerEmail: customerProfile?.email || '',
          budget: Number.isFinite(normalizedBudget) ? normalizedBudget : 0,
          budgetType,
          assigneeId: assigneeId || null,
          assigneeName: resolvedAssigneeName,
          assignedHelperName: resolvedAssigneeName,
          assignedTo: assignment
            ? { userId: assignment.userId, name: assignment.name, email: assignment.email }
            : null,
          taskCallStatus: callRecord?.status || 'not_updated',
          taskCallFollowUpDate: callRecord?.followUpDate || null,
          taskCallUpdatedAt: callRecord?.updatedAt || null,
          isHourly,
          paymentAmount,
          isFreeCoupon,
          paymentType: isFreeCoupon ? 'free_coupon' : 'paid',
          couponCode: order?.couponCode || null,
          couponDiscount: order?.couponDiscount || null,
          postedBy: isTeamPosted ? 'team' : 'customer',
          isTeamPosted,
        };
      });
    } catch (err) {
      logger.error('TaskManagementController: failed to build compiled tasks directly from DB', err);
      throw err;
    }
  }

  public static async getCompiledTasks(): Promise<any[]> {
    const now = Date.now();

    // 1. Fresh cache: return immediately (< 1ms)
    if (tasksCache && tasksCache.expiresAt > now) {
      return tasksCache.tasks;
    }

    // 2. Stale-while-revalidate: serve stale cache immediately while refreshing in background
    if (tasksCache && tasksCache.tasks.length > 0) {
      if (!buildTasksPromise) {
        const currentVersion = tasksCacheVersion;
        buildTasksPromise = TaskManagementController.buildCompiledTasks()
          .then((newTasks) => {
            if (currentVersion === tasksCacheVersion) {
              tasksCache = { tasks: newTasks, expiresAt: Date.now() + TASKS_CACHE_TTL_MS };
            }
            return newTasks;
          })
          .catch((err) => {
            logger.warn('TaskManagementController: background cache refresh failed', err);
            return tasksCache ? tasksCache.tasks : [];
          })
          .finally(() => {
            buildTasksPromise = null;
          });
      }
      return tasksCache.tasks;
    }

    // 3. Cold start: wait for build
    if (!buildTasksPromise) {
      const currentVersion = tasksCacheVersion;
      buildTasksPromise = TaskManagementController.buildCompiledTasks()
        .then((newTasks) => {
          if (currentVersion === tasksCacheVersion) {
            tasksCache = { tasks: newTasks, expiresAt: Date.now() + TASKS_CACHE_TTL_MS };
          }
          return newTasks;
        })
        .finally(() => {
          buildTasksPromise = null;
        });
    }
    return buildTasksPromise;
  }

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
      const postedByParam = String(req.query.postedBy || '').trim().toLowerCase();
      const requestedStatus = String(req.query.status || '').trim();
      const bookingSource = String(req.query.bookingSource || '').trim();
      const paymentType = String(req.query.paymentType || '').trim(); // 'paid' | 'free_coupon' | ''
      const isOverdueFilter = requestedStatus === 'overdue';
      const search = String(req.query.search || '').trim().toLowerCase();
      const category = String(req.query.category || '').trim();
      const scheduledDateFrom = req.query.scheduledDateFrom as string;
      const scheduledDateTo = req.query.scheduledDateTo as string;
      const sortBy = String(req.query.sortBy || 'scheduledDate');
      const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.max(1, Number(req.query.limit) || 20);

      const assigneeFilter =
        assignedToParam && assignedToParam !== 'all'
          ? resolveAssigneeFilter(assignedToParam)
          : null;
      const assigneeFilterUserId = assigneeFilter
        ? await resolveAssigneeFilterUserId(assigneeFilter)
        : null;

      let allTasks: any[];
      try {
        allTasks = await TaskManagementController.getCompiledTasks();
      } catch (cacheErr) {
        logger.warn('TaskManagementController: falling back to upstream listTasks', cacheErr);
        allTasks = await fetchTasksForLocalFiltering({});
      }

      const now = new Date();
      let filtered = allTasks;

      // 1. Search filter
      if (search) {
        filtered = filtered.filter((t) => {
          const title = String(t.title || '').toLowerCase();
          const desc = String(t.description || '').toLowerCase();
          const tid = String(t.taskId || '').toLowerCase();
          const cName = String(t.customerName || '').toLowerCase();
          const cPhone = String(t.customerPhone || '').toLowerCase();
          const cEmail = String(t.customerEmail || '').toLowerCase();
          const cId = String(t.CustomerId || '').toLowerCase();
          const hName = String(t.assigneeName || '').toLowerCase();
          const cat = String(t.category || '').toLowerCase();
          return (
            title.includes(search) ||
            desc.includes(search) ||
            tid.includes(search) ||
            cName.includes(search) ||
            cPhone.includes(search) ||
            cEmail.includes(search) ||
            cId.includes(search) ||
            hName.includes(search) ||
            cat.includes(search)
          );
        });
      }

      // 2. Booking source (work type)
      if (bookingSource && bookingSource !== 'all') {
        filtered = filtered.filter((t) => String(t.bookingSource || '') === bookingSource);
      }

      // 3. Status & Overdue
      if (isOverdueFilter) {
        filtered = filtered.filter((t) => {
          if (t.status !== 'open') return false;
          if (!t.scheduledDate) return false;
          if (t.dateOption === 'flexible') return false;
          return new Date(t.scheduledDate) < now;
        });
      } else if (requestedStatus === 'open') {
        filtered = filtered.filter((t) => {
          if (t.status !== 'open') return false;
          if (!t.scheduledDate) return true;
          if (t.dateOption === 'flexible') return true;
          return new Date(t.scheduledDate) >= now;
        });
      } else if (requestedStatus && requestedStatus !== 'all') {
        filtered = filtered.filter((t) => t.status === requestedStatus);
      }

      // 4. Category
      if (category && category !== 'all') {
        const catLower = category.toLowerCase();
        filtered = filtered.filter(
          (t) =>
            String(t.category || '').toLowerCase() === catLower ||
            String(t.categorySlug || '').toLowerCase() === catLower,
        );
      }

      // 5. Customer ID
      if (customerFilter) {
        filtered = filtered.filter(
          (t) =>
            String(t.CustomerId || '') === customerFilter ||
            String(t.customerId || '') === customerFilter ||
            String(t.requesterId || '') === customerFilter,
        );
      }

      // 6. Assignee (Helper) ID
      if (req.query.assigneeId) {
        const aid = String(req.query.assigneeId);
        filtered = filtered.filter(
          (t) =>
            String(t.assigneeId || '') === aid ||
            String(t.assigneeUid || '') === aid ||
            String(t.partnerId || '') === aid ||
            String(t.partnerUid || '') === aid,
        );
      }

      // 7. Follow-up status
      if (followUpStatus && followUpStatus !== 'all') {
        filtered = filtered.filter((t) => t.taskCallStatus === followUpStatus);
      }

      // 8. Assigned Ops Admin
      if (assigneeFilter) {
        filtered = filtered.filter((t) =>
          taskMatchesAssigneeFilter(t.assignedTo, assigneeFilter, assigneeFilterUserId),
        );
      }

      // 9. Posted by (team vs customer)
      if (postedByParam === 'team') {
        filtered = filtered.filter((t) => t.postedBy === 'team');
      } else if (postedByParam === 'customer') {
        filtered = filtered.filter((t) => t.postedBy === 'customer');
      }

      // 10. Payment type
      if (paymentType && paymentType !== 'all') {
        if (paymentType === 'free_coupon') {
          filtered = filtered.filter((t) => t.isFreeCoupon === true);
        } else if (paymentType === 'paid') {
          filtered = filtered.filter((t) => t.isFreeCoupon !== true);
        }
      }

      // 11. Scheduled Date Range
      if (scheduledDateFrom || scheduledDateTo) {
        const fromDate = scheduledDateFrom
          ? new Date(`${scheduledDateFrom}T00:00:00.000+05:30`)
          : null;
        const toDate = scheduledDateTo
          ? new Date(`${scheduledDateTo}T00:00:00.000+05:30`)
          : null;
        if (toDate) toDate.setDate(toDate.getDate() + 1);

        filtered = filtered.filter((t) => {
          if (!t.scheduledDate) return false;
          const taskDate = new Date(t.scheduledDate);
          if (isNaN(taskDate.getTime())) return false;
          if (fromDate && taskDate < fromDate) return false;
          if (toDate && taskDate >= toDate) return false;
          return true;
        });
      }

      // 12. Sorting
      const isAsc = sortOrder === 'asc';
      filtered = [...filtered].sort((a, b) => {
        if (sortBy === 'scheduledDate') {
          const dateA = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0;
          const dateB = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0;
          if (dateA !== dateB) {
            if (!dateA) return 1;
            if (!dateB) return -1;
            return isAsc ? dateA - dateB : dateB - dateA;
          }

          const timeA = a.scheduledTimeStart || '';
          const timeB = b.scheduledTimeStart || '';
          if (timeA && timeB && timeA !== timeB) {
            return isAsc ? timeA.localeCompare(timeB) : timeB.localeCompare(timeA);
          }

          const crA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const crB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return isAsc ? crA - crB : crB - crA;
        }

        const crA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const crB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return isAsc ? crA - crB : crB - crA;
      });

      // 13. Pagination
      const total = filtered.length;
      const pages = Math.max(1, Math.ceil(total / limit));
      const start = (page - 1) * limit;
      const paginated = filtered.slice(start, start + limit);

      res.json({
        success: true,
        data: paginated,
        pagination: {
          page,
          limit,
          total,
          pages,
        },
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

      // Run all three enrichment operations in parallel — they are independent of each other.
      // Previously they ran sequentially which caused 10+ second load times because each
      // awaited the previous (DB query → admin-service DB query → user-service HTTP call).
      const [withCallStatus, withAssignedTo, withAssigneeName] = await Promise.all([
        enrichTasksWithTaskCallStatus([normalizedTask]),
        enrichTasksWithAssignedTo([normalizedTask]),
        enrichTasksWithAssigneeName([normalizedTask]),
      ]);

      // Merge only the fields each enrichment adds, keeping normalizedTask as the base
      // so that assignment fields (assigneeId, assigneeName, etc.) are never overwritten
      // by a stale enrichment result.
      const enrichedTask = {
        ...normalizedTask,
        // from enrichTasksWithTaskCallStatus
        taskCallStatus: withCallStatus[0]?.taskCallStatus,
        taskCallFollowUpDate: withCallStatus[0]?.taskCallFollowUpDate,
        taskCallUpdatedAt: withCallStatus[0]?.taskCallUpdatedAt,
        // from enrichTasksWithAssignedTo (CRM admin assignment, not helper)
        assignedTo: withAssignedTo[0]?.assignedTo,
        // from enrichTasksWithAssigneeName (resolved display name for helper)
        ...(withAssigneeName[0]?.assigneeName != null
          ? { assigneeName: withAssigneeName[0].assigneeName }
          : {}),
      };
      
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
   * POST /api/v1/tasks/:taskId/send-email
   * Manually send the configured work-posted email recipients an alert.
   */
  static async sendTaskPostedEmail(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      const result = await taskServiceClient.getTask(taskId);
      const task = result?.data || result;
      const requesterId = normalizeTaskIdForAssignment(
        task?.CustomerId || task?.customerId || task?.requesterId,
      );
      let profile: any = null;

      if (requesterId) {
        const profileBatch = await userServiceClient.getProfilesBatch([requesterId]);
        profile = Array.isArray(profileBatch?.profiles) ? profileBatch.profiles[0] : null;
      }

      const settings = await getTaskPostedEmailSettings();
      if (isPhoneExcluded(profile?.phone, settings.excludedPhones)) {
        logger.info('[TaskPostedEmail][main-admin-server] Manual email skipped for excluded customer phone', {
          taskId,
        });
        res.json({ success: true, sent: false, skipped: true, reason: 'excluded_customer_phone' });
        return;
      }

      const sent = await sendTaskPostedEmail({
        taskId,
        taskTitle: task?.title,
        userName: profile?.name || profile?.fullName,
        userPhone: profile?.phone,
      });

      res.json({ success: sent, sent, skipped: !sent });
    } catch (error: any) {
      logger.error('Manual task-posted email error', {
        taskId: req.params.taskId,
        error: error?.message || String(error),
      });
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to send task-posted email',
      });
    }
  }

  static async getTaskPostedEmailStatus(req: Request, res: Response): Promise<void> {
    try {
      const status = await TaskPostedEmailAttempt.findOne({ taskId: req.params.taskId }).lean();
      res.json({ success: true, data: status || null });
    } catch (error: any) {
      logger.error('Get task-posted email status error', { taskId: req.params.taskId, error: error?.message });
      res.status(500).json({ success: false, error: 'Failed to load email status' });
    }
  }
  
  /**
   * PATCH /api/v1/tasks/:taskId
   * Update task
   */
  static async updateTask(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      const updates = req.body || {};

      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        if (Object.keys(updates).some((key) => key !== 'status')) {
          res.status(400).json({
            success: false,
            error: 'Works status must be updated separately from other task fields',
          });
          return;
        }

        if (!req.admin?.isSuperAdmin) {
          res.status(403).json({
            success: false,
            error: 'Only Super Admin can update works status',
          });
          return;
        }

        const validStatuses = [
          'open',
          'assigned',
          'started',
          'in_progress',
          'review',
          'completed',
          'cancelled',
        ];
        if (!validStatuses.includes(updates.status)) {
          res.status(400).json({
            success: false,
            error: 'Invalid works status',
          });
          return;
        }
      }

      const result = Object.prototype.hasOwnProperty.call(updates, 'status')
        ? await taskServiceClient.updateTaskStatus(taskId, updates.status)
        : await taskServiceClient.updateTask(taskId, updates);
      TaskManagementController.invalidateCache();
      
      await createAuditLog(
        req,
        `${Resource.TASK}.update`,
        Resource.TASK,
        taskId,
        { updates }
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

      const result = await taskServiceClient.deleteTask(taskId, reason.trim());
      TaskManagementController.invalidateCache();
      
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
      TaskManagementController.invalidateCache();

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
      const { helperUid, helperProfileId, helperName, assignmentRole } = req.body;
      const adminUserId = (req.admin as any)?.userId;

      if (!helperUid || !helperProfileId) {
        res.status(400).json({ success: false, error: 'helperUid and helperProfileId are required' });
        return;
      }

      // ── PARTNER assignment: sets task.partnerId/partnerUid → shows in partner screen ──
      if (assignmentRole === 'partner') {
        const result = await taskServiceClient.assignPartnerDirect({
          taskId,
          partnerUid: helperUid,
          partnerProfileId: helperProfileId,
          partnerName: helperName,
        }, adminUserId);
        TaskManagementController.invalidateCache();

        await createAuditLog(
          req,
          `${Resource.TASK}.assign_partner_direct`,
          Resource.TASK,
          taskId,
          { partnerUid: helperUid, helperProfileId, assignmentRole: 'partner' }
        );

        res.json({ success: true, data: result.data || result });
        return;
      }

      // ── HELPER assignment (default): creates TaskApplication → shows in helper/tasker screen ──
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

        // Invalidate cache so next getTask() returns fresh (assigned) data
        taskServiceClient.invalidateTaskCache(taskId);
        TaskManagementController.invalidateCache();

        res.json({ success: true, data: result.data || result });
      } else {
        logger.info(`Using direct helper assignment fallback for task ${taskId}`);
        const result = await taskServiceClient.assignHelperDirect({
          taskId,
          helperUid,
          helperProfileId,
          helperName,
        }, adminUserId);
        TaskManagementController.invalidateCache();

        await createAuditLog(
          req,
          `${Resource.TASK}.assign_helper_direct`,
          Resource.TASK,
          taskId,
          { helperUid, helperProfileId }
        );

        res.json({ success: true, data: result.data || result });
      }
    } catch (error: any) {
      logger.error('Assign helper error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to assign helper',
      });
    }
  }

  static async notifyBookNowDispatchStage(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      const { stage } = req.body || {};
      if (stage !== 'area_rule' && stage !== 'all') {
        res.status(400).json({ success: false, error: 'Stage must be area_rule or all' });
        return;
      }

      const result = await taskServiceClient.notifyBookNowDispatchStage(taskId, stage);
      taskServiceClient.invalidateTaskCache(taskId);
      TaskManagementController.invalidateCache();

      await createAuditLog(
        req,
        `${Resource.TASK}.notify_dispatch_stage`,
        Resource.TASK,
        taskId,
        { stage, notifiedCount: result?.data?.notifiedCount ?? result?.notifiedCount ?? 0 },
      );

      res.json({ success: true, data: result.data || result });
    } catch (error: any) {
      logger.error('Notify Book Now dispatch stage error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to notify eligible partners',
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

      // Perform the delete using admin privileges (task-service bypasses requester check for main-admin-service)
      await taskServiceClient.deleteTask(requestDoc.taskId, requestDoc.reason);
      TaskManagementController.invalidateCache();

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

      const result = await taskServiceClient.restoreTask(taskId);
      TaskManagementController.invalidateCache();

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

      const result = await taskServiceClient.permanentlyDeleteTask(taskId, reason ? { reason } : undefined);
      TaskManagementController.invalidateCache();

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
