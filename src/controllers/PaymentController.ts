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

      let transactions = await Promise.all(
        rawTransactions.map(async (row: any) => {
          const posterUid = row.posterUid || row.CustomerUid;
          const [customer, helper, taskTitle] = await Promise.all([
            resolveUser(posterUid),
            resolveUser(row.performerUid),
            resolveTaskTitle(row.taskId),
          ]);

          const customerName = (customer.name || posterUid || '').toString();
          const isTeamTestByName = customerName.trim().toLowerCase() === 'allam test';
          const teamTestFlag = typeof row.teamTest === 'boolean' ? row.teamTest : isTeamTestByName;

          return {
            ...row,
            teamTest: teamTestFlag,
            posterUid: posterUid,
            links: {
              customerUserId: customer.userId,
              helperUserId: helper.userId,
              taskId: row.taskId,
              customerName: customerName || posterUid,
              taskTitle: taskTitle || row.taskId,
              helperName: helper.name || row.performerUid,
            },
          };
        })
      );

      // Apply local transactionType filtering if requested. We derive teamTest above
      const transactionType = (req.query as any).transactionType as string | undefined;
      if (transactionType === 'team') {
        transactions = transactions.filter((t: any) => !!t.teamTest);
      } else if (transactionType === 'real') {
        transactions = transactions.filter((t: any) => !t.teamTest);
      }

      // Apply pagination locally if limit/offset were provided (upstream may have returned unfiltered pages)
      const limit = Math.min(Number((req.query as any).limit) || 200, 200);
      const offset = Number((req.query as any).offset) || 0;
      const total = transactions.length;
      const paged = transactions.slice(offset, offset + limit);

      res.json({
        success: true,
        data: paged,
        total: total,
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
    try {
      const { id } = req.params;
      const { status } = req.body || {};
      if (!id) {
        throw new Error('Payout id is required');
      }
      if (!status || typeof status !== 'string') {
        throw new Error('status is required');
      }

      const payload = await paymentServiceClient.patch(`/api/v1/dashboard/payouts/${id}/status`, { status });
      res.json({ success: true, data: payload });
    } catch (error: any) {
      logger.error('Update payout status error:', error);
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
        { success: true, items: [], total: 0 }
      );
      res.json({
        success: true,
        data: data.refunds ?? data.items ?? [],
        total: data.total ?? 0,
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
}
