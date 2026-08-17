import { Request, Response } from 'express';
import logger from '../config/logger';
import { paymentServiceClient } from '../services/PaymentServiceClient';
import { userServiceClient } from '../services/UserServiceClient';
import { taskServiceClient } from '../services/TaskServiceClient';
import { getClientSafeStatus } from '../utils/upstreamHttp';

async function safeGet<T>(
  path: string,
  params?: Record<string, any>,
  fallback?: T
): Promise<T> {
  try {
    return await paymentServiceClient.get(path, params);
  } catch (error: any) {
    logger.error(`PaymentController safeGet failed for ${path}:`, {
      message: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
    });
    if (fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

export class PaymentController {
  static async getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overviewResult = await safeGet<any>(
        '/api/v1/dashboard/overview',
        req.query as Record<string, any>,
        {}
      );
      const anomaliesResult = await safeGet<any>(
        '/api/v1/dashboard/anomalies',
        req.query as Record<string, any>,
        { anomalies: { counts: {} } }
      );

      const o = overviewResult?.overview ?? overviewResult ?? {};
      const counts = anomaliesResult?.anomalies?.counts ?? {};
      res.json({
        success: true,
        data: {
          metrics: {
            totalPayins: o.gmv ?? null,
            totalRefunds: o.totalRefunds ?? null,
            totalPayouts: o.totalPayouts ?? null,
            capturedCount: typeof o.totalPayins === 'number' ? o.totalPayins : 0,
            failedCount: 0,
            successRate:
              typeof o.paymentSuccessRate === 'number'
                ? o.paymentSuccessRate / 100
                : 0,
          },
          alerts: [
            {
              type: 'failed_payout_spike',
              count: counts.failedPayoutsNoRetry ?? 0,
              windowHours: 24,
            },
            {
              type: 'pending_payouts',
              count: counts.pendingJobQueuePayouts ?? 0,
              windowHours: 24,
            },
            {
              type: 'escrows_held_too_long',
              count: counts.escrowsHeldTooLong ?? 0,
              windowHours: 168,
            },
          ],
        },
      });
    } catch (error: any) {
      logger.error('Payment overview error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch payments overview',
      });
    }
  }

  static async listTransactions(req: Request, res: Response): Promise<void> {
    try {
      const data = await safeGet<any>(
        '/api/v1/dashboard/all-transactions',
        req.query as Record<string, any>,
        { success: true, total: 0, transactions: [] }
      );

      const rawTransactions = data.data ?? data.transactions ?? [];
      const userCache = new Map<string, { userId?: string; name?: string }>();
      const taskTitleCache = new Map<string, string>();

      // Optimization: Extract all unique IDs to fetch in batch
      const uniqueUids = new Set<string>();
      const uniqueTaskIds = new Set<string>();

      rawTransactions.forEach((row: any) => {
        const posterUid = row.posterUid || row.CustomerUid;
        if (posterUid) uniqueUids.add(posterUid);
        if (row.performerUid) uniqueUids.add(row.performerUid);
        if (row.taskId) uniqueTaskIds.add(row.taskId);
      });

      // Fetch in batch to avoid N+1 requests and slow individual stats lookups
      await Promise.all([
        (async () => {
          if (uniqueUids.size > 0) {
            try {
              const usersResult = await userServiceClient.getProfilesBatchByUids(Array.from(uniqueUids));
              const users = usersResult?.profiles || [];
              users.forEach((u: any) => {
                userCache.set(u.uid, {
                  userId: u.uid,
                  name: u.name,
                });
              });
            } catch (err) {
              logger.warn('Batch user resolution failed, falling back to individual lookups');
            }
          }
        })(),
        (async () => {
          if (uniqueTaskIds.size > 0) {
            try {
              const tasksResult = await taskServiceClient.getTasksBatch(Array.from(uniqueTaskIds));
              const tasks = tasksResult?.tasks || [];
              tasks.forEach((t: any) => {
                taskTitleCache.set(t._id || t.id, t.title);
              });
            } catch (err) {
              logger.warn('Batch task resolution failed, falling back to individual lookups');
            }
          }
        })(),
      ]);

      const resolveUser = async (
        uid?: string
      ): Promise<{ userId?: string; name?: string }> => {
        if (!uid) return {};
        if (userCache.has(uid)) {
          return userCache.get(uid) || {};
        }
        try {
          // Individual fallback if not in batch
          const userResult = await userServiceClient.getUser(uid);
          const exact = userResult?.data || userResult;
          const resolved = {
            userId: exact?.uid || exact?.userId || exact?._id,
            name:
              exact?.name ||
              [exact?.firstName, exact?.lastName].filter(Boolean).join(' ') ||
              undefined,
          };
          userCache.set(uid, resolved);
          return resolved;
        } catch (error) {
          logger.warn(`Failed to resolve uid ${uid} to user details`);
        }
        return {};
      };

      const resolveTaskTitle = async (taskId?: string): Promise<string | undefined> => {
        if (!taskId) return undefined;
        if (taskTitleCache.has(taskId)) {
          return taskTitleCache.get(taskId);
        }
        try {
          // Individual fallback if not in batch
          const taskResult = await taskServiceClient.getTask(taskId);
          const taskData = taskResult?.data || taskResult;
          const title = taskData?.title as string | undefined;
          if (title) {
            taskTitleCache.set(taskId, title);
            return title;
          }
        } catch (error) {
          logger.warn(`Failed to resolve task title for taskId ${taskId}`);
        }
        return undefined;
      };

      const transactions = await Promise.all(
        rawTransactions.map(async (row: any) => {
          const posterUid = row.posterUid || row.CustomerUid;
          const [customer, helper, taskTitle] = await Promise.all([
            resolveUser(posterUid),
            resolveUser(row.performerUid),
            resolveTaskTitle(row.taskId),
          ]);

          return {
            ...row,
            posterUid: posterUid,
            links: {
              customerUserId: customer.userId,
              helperUserId: helper.userId,
              taskId: row.taskId,
              customerName: customer.name || posterUid,
              taskTitle: taskTitle || row.taskId,
              helperName: helper.name || row.performerUid,
            },
          };
        })
      );

      res.json({
        success: true,
        data: transactions,
        total: data.pagination?.total ?? data.total ?? 0,
      });
    } catch (error: any) {
      logger.error('List transactions error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list transactions',
      });
    }
  }

  static async markTransactionTeamTest(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { teamTest } = req.body || {};
      if (!id) {
        throw new Error('Transaction id is required');
      }
      if (typeof teamTest !== 'boolean') {
        throw new Error('teamTest must be a boolean');
      }

      const payload = await paymentServiceClient.patch(`/api/v1/dashboard/transactions/${id}/team-test`, { teamTest });
      res.json({ success: true, data: payload });
    } catch (error: any) {
      logger.error('Mark transaction team test error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update transaction test status',
      });
    }
  }

  static async updatePayoutStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { status } = req.body || {};
    try {
      if (!id) {
        throw new Error('Payout id is required');
      }
      if (!status || typeof status !== 'string') {
        throw new Error('status is required');
      }

      // Encode so IDs with underscores/special chars never break path parsing.
      // Prefer dashboard route (has PATCH status). Lookup accepts both internal id and business payoutId.
      const encodedId = encodeURIComponent(id);
      const payload = await paymentServiceClient.patch(
        `/api/v1/dashboard/payouts/${encodedId}/status`,
        { status },
      );
      res.json({ success: true, data: payload });
    } catch (error: any) {
      logger.error('Update payout status error:', {
        payoutId: id,
        status,
        message: error?.message,
        upstreamStatus: error?.response?.status,
        upstreamError: error?.response?.data,
      });
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update payout status',
      });
    }
  }

  static async listPayouts(req: Request, res: Response): Promise<void> {
    try {
      const q = (req.query as any).q as string | undefined;
      const params: Record<string, any> = {
        ...(req.query as Record<string, any>),
        ...(q ? { q } : {}),
        limit: Math.min(Number(req.query.limit) || 200, 200),
        offset: Number(req.query.offset) || 0,
      };
      delete params.q;

      const data = await safeGet<any>('/api/v1/admin/payouts', params, {
        success: true,
        payouts: [],
        total: 0,
      });

      const rawRows = data.data ?? data.payouts ?? data.items ?? [];
      const rows = rawRows.map((row: any) => ({
        payoutId: row.payoutId,
        performerUid: row.performerUid,
        taskId: row.taskId || row.escrow?.taskId || null,
        CustomerUid: row.CustomerUid || row.escrow?.posterUid || null,
        amount: String(row.amount ?? ''),
        netAmount: String(row.netAmount ?? ''),
        status: row.status,
        source: row.source || row.type || null,
        type: row.type || null,
        createdAt: row.createdAt,
      }));

      res.json({
        success: true,
        data: rows,
        total: data.pagination?.total ?? data.total ?? rows.length,
      });
    } catch (error: any) {
      logger.error('List payouts error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list payouts',
      });
    }
  }

  static async listRefunds(req: Request, res: Response): Promise<void> {
    try {
      const data = await safeGet<any>(
        '/api/v1/dashboard/refunds',
        req.query as Record<string, any>,
        { success: true, data: [], items: [], total: 0 }
      );

      const rawRefunds = data.data ?? data.refunds ?? data.items ?? [];
      const userCache = new Map<string, { userId?: string; name?: string }>();
      const taskTitleCache = new Map<string, string>();
      const uniqueUids = new Set<string>();
      const uniqueTaskIds = new Set<string>();

      rawRefunds.forEach((row: any) => {
        const posterUid = row.posterUid || row.CustomerUid;
        if (posterUid) uniqueUids.add(posterUid);
        if (row.performerUid) uniqueUids.add(row.performerUid);
        if (row.taskId) uniqueTaskIds.add(row.taskId);
      });

      // If CustomerUid was missing on some rows, look up the task to get customerId / posterUid
      const taskCustomerMap = new Map<string, string>();
      if (uniqueTaskIds.size > 0) {
        try {
          const tasksResult = await taskServiceClient.getTasksBatch(Array.from(uniqueTaskIds));
          const tasks = tasksResult?.tasks || [];
          tasks.forEach((t: any) => {
            const tid = String(t._id || t.id);
            if (t.title) taskTitleCache.set(tid, t.title);
            const custId = t.customerId || t.posterUid || t.userId || t.creatorId;
            if (custId) {
              taskCustomerMap.set(tid, String(custId));
              uniqueUids.add(String(custId));
            }
          });
        } catch (err) {
          logger.warn('Batch task lookup for refunds failed');
        }
      }

      if (uniqueUids.size > 0) {
        try {
          const usersResult = await userServiceClient.getProfilesBatchByUids(Array.from(uniqueUids));
          const users = usersResult?.profiles || [];
          users.forEach((u: any) => {
            userCache.set(u.uid, {
              userId: u.uid,
              name: u.name,
            });
          });
        } catch (err) {
          logger.warn('Batch user resolution for refunds failed');
        }
      }

      const resolveUser = async (uid?: string): Promise<{ userId?: string; name?: string }> => {
        if (!uid) return {};
        if (userCache.has(uid)) return userCache.get(uid) || {};
        try {
          const userResult = await userServiceClient.getUser(uid);
          const exact = userResult?.data || userResult;
          const resolved = {
            userId: exact?.uid || exact?.userId || exact?._id,
            name: exact?.name || [exact?.firstName, exact?.lastName].filter(Boolean).join(' ') || undefined,
          };
          userCache.set(uid, resolved);
          return resolved;
        } catch { /* ignore */ }
        return {};
      };

      const resolveTaskTitle = async (taskId?: string): Promise<string | undefined> => {
        if (!taskId) return undefined;
        if (taskTitleCache.has(taskId)) return taskTitleCache.get(taskId);
        try {
          const taskResult = await taskServiceClient.getTask(taskId);
          const taskData = taskResult?.data || taskResult;
          const title = taskData?.title as string | undefined;
          if (title) {
            taskTitleCache.set(taskId, title);
            return title;
          }
        } catch { /* ignore */ }
        return undefined;
      };

      const refunds = await Promise.all(
        rawRefunds.map(async (row: any) => {
          let posterUid = row.CustomerUid || row.posterUid;
          if (!posterUid && row.taskId && taskCustomerMap.has(row.taskId)) {
            posterUid = taskCustomerMap.get(row.taskId);
          }

          const [customer, helper, taskTitle] = await Promise.all([
            resolveUser(posterUid),
            resolveUser(row.performerUid),
            resolveTaskTitle(row.taskId),
          ]);

          return {
            ...row,
            CustomerUid: posterUid || null,
            links: {
              customerUserId: customer.userId || posterUid,
              helperUserId: helper.userId || row.performerUid,
              taskId: row.taskId,
              customerName: customer.name || posterUid,
              taskTitle: taskTitle || row.taskId,
              helperName: helper.name || row.performerUid,
            },
          };
        })
      );

      res.json({
        success: true,
        data: refunds,
        total: data.pagination?.total ?? data.total ?? refunds.length,
      });
    } catch (error: any) {
      logger.error('List refunds error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list refunds',
      });
    }
  }

  static async listLedger(req: Request, res: Response): Promise<void> {
    try {
      const data = await safeGet<any>(
        '/api/v1/dashboard/ledger',
        req.query as Record<string, any>,
        { success: true, items: [], total: 0 }
      );
      res.json({
        success: true,
        data: data.ledger ?? data.items ?? [],
        total: data.total ?? 0,
      });
    } catch (error: any) {
      logger.error('List ledger error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list ledger',
      });
    }
  }

  static async getUserBankAccounts(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!id) {
        throw new Error('User id is required');
      }
      const data = await safeGet<any>(
        `/api/v1/admin/users/${id}/financial-profile`,
        undefined,
        { success: true, bankAccounts: [] }
      );
      res.json({
        success: true,
        data: {
          bankAccounts: data?.bankAccounts ?? [],
        },
      });
    } catch (error: any) {
      logger.error('Get user bank accounts error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch user bank accounts',
      });
    }
  }

  static async processRefund(req: Request, res: Response): Promise<void> {
    try {
      const {
        razorpayOrderId,
        razorpayPaymentId,
        taskId,
        reason,
        cancelledBy,
        taskStartDate,
        cancelledAt,
        userId,
        amount,
        assignedAt,
        feeBaseAmount,
      } = req.body;

      // Allow refund if we at least have a taskId to fall back on
      if (!razorpayOrderId && !taskId) {
        res.status(400).json({
          success: false,
          error: 'razorpayOrderId or taskId is required',
        });
        return;
      }

      if (!cancelledBy || !['poster', 'performer'].includes(cancelledBy)) {
        res.status(400).json({
          success: false,
          error: 'cancelledBy must be either "poster" or "performer"',
        });
        return;
      }

      if (!taskStartDate || !cancelledAt) {
        res.status(400).json({
          success: false,
          error: 'taskStartDate and cancelledAt are required',
        });
        return;
      }

      const data = await paymentServiceClient.post('/api/v1/refunds/process', {
        razorpayOrderId: razorpayOrderId || '',
        razorpayPaymentId: razorpayPaymentId || '',
        taskId,
        reason,
        cancelledBy,
        taskStartDate,
        cancelledAt,
        userId,
        amount,
        assignedAt,
        feeBaseAmount,
      });

      res.json({
        success: true,
        data: data.refund ?? data,
      });
    } catch (error: any) {
      logger.error('Process refund error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to process refund',
      });
    }
  }
}
