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
      const requestedLimit = Math.min(Number((req.query as any).limit) || 10, 500);
      const requestedOffset = Number((req.query as any).offset) || 0;
      const transactionType = (req.query as any).transactionType as string | undefined;

      const upstreamParams: Record<string, any> = { ...req.query };
      if (transactionType === 'all') {
        delete upstreamParams.transactionType;
      }

      const data = await safeGet<any>(
        '/api/v1/dashboard/all-transactions',
        upstreamParams,
        { success: true, total: 0, transactions: [] }
      );

      const rawTransactions = data.data ?? data.transactions ?? [];
      const userCache = new Map<string, { userId?: string; name?: string }>();
      const taskTitleCache = new Map<string, string>();
      const taskAssigneeCache = new Map<string, string>();

      // Collect all unique UIDs (customer + helper — payment service already resolved helper from payout)
      const uniqueUids = new Set<string>();
      const uniqueTaskIds = new Set<string>();

      rawTransactions.forEach((row: any) => {
        const posterUid = row.posterUid || row.CustomerUid;
        if (posterUid) uniqueUids.add(posterUid);
        if (row.performerUid && row.performerUid !== 'pending_assignment') uniqueUids.add(row.performerUid);
        if (row.taskId) uniqueTaskIds.add(row.taskId);
      });

      // Batch fetch users and task titles
      await Promise.all([
        (async () => {
          if (uniqueUids.size > 0) {
            try {
              const usersResult = await userServiceClient.getProfilesBatchByUids(Array.from(uniqueUids));
              (usersResult?.profiles || []).forEach((u: any) => {
                userCache.set(u.uid, { userId: u.uid, name: u.name });
              });
            } catch (err) {
              logger.warn('Batch user resolution failed');
            }
          }
        })(),
        (async () => {
          if (uniqueTaskIds.size > 0) {
            try {
              const tasksResult = await taskServiceClient.getTasksBatch(Array.from(uniqueTaskIds));
              (tasksResult?.tasks || []).forEach((t: any) => {
                const taskId = t._id || t.id;
                taskTitleCache.set(taskId, t.title);
                const assigneeUid = t.assigneeUid || t.assigneeId;
                if (assigneeUid) {
                  taskAssigneeCache.set(taskId, assigneeUid);
                  uniqueUids.add(assigneeUid);
                }
              });
            } catch (err) {
              logger.warn('Batch task resolution failed');
            }
          }
        })(),
      ]);

      // Re-resolve users for any assigneeUids discovered from tasks
      if (uniqueUids.size > 0) {
        try {
          const usersResult = await userServiceClient.getProfilesBatchByUids(Array.from(uniqueUids));
          (usersResult?.profiles || []).forEach((u: any) => {
            if (!userCache.has(u.uid)) {
              userCache.set(u.uid, { userId: u.uid, name: u.name });
            }
          });
        } catch (err) {
          logger.warn('Batch re-resolution of users failed');
        }
      }

      const resolveUser = async (uid?: string): Promise<{ userId?: string; name?: string }> => {
        if (!uid || uid === 'pending_assignment') return {};
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
        } catch {
          logger.warn(`Failed to resolve uid ${uid}`);
        }
        return {};
      };

      const resolveTaskTitle = async (taskId?: string): Promise<string | undefined> => {
        if (!taskId) return undefined;
        if (taskTitleCache.has(taskId)) return taskTitleCache.get(taskId);
        try {
          const taskResult = await taskServiceClient.getTask(taskId);
          const title = (taskResult?.data || taskResult)?.title as string | undefined;
          if (title) { taskTitleCache.set(taskId, title); return title; }
        } catch {
          logger.warn(`Failed to resolve task title for ${taskId}`);
        }
        return undefined;
      };

      const transactions = await Promise.all(
        rawTransactions.map(async (row: any) => {
          const posterUid = row.posterUid || row.CustomerUid;
          // Try payment service performer first, then fall back to task's assigneeUid for Book Now
          const performerUid = row.performerUid !== 'pending_assignment'
            ? row.performerUid
            : taskAssigneeCache.get(row.taskId) || undefined;

          const [customer, helper, taskTitle] = await Promise.all([
            resolveUser(posterUid),
            resolveUser(performerUid),
            resolveTaskTitle(row.taskId),
          ]);

          const customerName = (customer.name || posterUid || '').toString();
          const isTeamTestByName = customerName.trim().toLowerCase() === 'allam test';
          const teamTestFlag = isTeamTestByName || (typeof row.teamTest === 'boolean' ? row.teamTest : false);

          return {
            ...row,
            teamTest: teamTestFlag,
            posterUid,
            payoutAmount: row.payoutAmount ?? null,
            performerUid: performerUid || 'pending_assignment',
            links: {
              customerUserId: customer.userId,
              helperUserId: helper.userId || performerUid,
              taskId: row.taskId,
              customerName: customerName || posterUid,
              taskTitle: taskTitle || row.taskId,
              helperName: helper.name || (performerUid ? performerUid : 'Pending Assignment'),
            },
          };
        })
      );

      const total = data.pagination?.total ?? data.total ?? transactions.length;
      res.json({ success: true, data: transactions, total });
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

  static async markPayoutTeamTest(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { teamTest } = req.body || {};
      if (!id) {
        throw new Error('Payout id is required');
      }
      if (typeof teamTest !== 'boolean') {
        throw new Error('teamTest must be a boolean');
      }

      const payload = await paymentServiceClient.patch(`/api/v1/dashboard/payouts/${id}/team-test`, { teamTest });
      res.json({ success: true, data: payload });
    } catch (error: any) {
      logger.error('Mark payout team test error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update payout transaction type',
      });
    }
  }

  static async listPayouts(req: Request, res: Response): Promise<void> {
    try {
      const requestedLimit = Math.min(Number((req.query as any).limit) || 10, 200);
      const requestedOffset = Number((req.query as any).offset) || 0;
      const transactionType = (req.query as any).transactionType as string | undefined;
      const q = (req.query as any).q as string | undefined;
      const params: Record<string, any> = {
        ...(req.query as Record<string, any>),
        ...(q ? { q } : {}),
      };
      if (transactionType === 'all') {
        delete params.transactionType;
      }
      delete params.q;

      const data = await safeGet<any>('/api/v1/admin/payouts', params, {
        success: true,
        payouts: [],
        total: 0,
      });

      const rawRows = data.data ?? data.payouts ?? data.items ?? [];
      const uniqueCustomerUids = new Set<string>();
      rawRows.forEach((row: any) => {
        const customerUid = row.CustomerUid || row.escrow?.posterUid || row.customerUid || row.posterUid;
        if (customerUid) uniqueCustomerUids.add(customerUid);
      });

      const customerNameByUid = new Map<string, string>();
      if (uniqueCustomerUids.size > 0) {
        try {
          const profilesResult = await userServiceClient.getProfilesBatchByUids(Array.from(uniqueCustomerUids));
          const profiles = profilesResult?.profiles ?? [];
          profiles.forEach((profile: any) => {
            const customerName =
              profile?.name ||
              [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
            if (profile?.uid) {
              customerNameByUid.set(profile.uid, customerName);
            }
          });
        } catch (err) {
          logger.warn('Batch payout customer resolution failed, falling back to raw values');
        }
      }

      const rows = rawRows.map((row: any) => {
        const customerUid = row.CustomerUid || row.escrow?.posterUid || row.customerUid || row.posterUid || null;
        const customerName =
          String(row.customerName || row.CustomerName || customerNameByUid.get(customerUid || '') || '').trim();
        const rawTeamTest =
          typeof row.teamTest === 'boolean'
            ? row.teamTest
            : typeof row.metadata?.teamTest === 'boolean'
            ? row.metadata.teamTest
            : false;
        const teamTest = rawTeamTest || customerName.toLowerCase() === 'allam test';

        return {
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
          teamTest,
        };
      });

      const total = data.pagination?.total ?? data.total ?? rows.length;

      res.json({
        success: true,
        data: rows,
        total: total,
      });
    } catch (error: any) {
      logger.error('List payouts error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list payouts',
      });
    }
  }

  static async markRefundTeamTest(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { teamTest } = req.body || {};
      if (!id) {
        throw new Error('Refund id is required');
      }
      if (typeof teamTest !== 'boolean') {
        throw new Error('teamTest must be a boolean');
      }

      const payload = await paymentServiceClient.patch(`/api/v1/dashboard/refunds/${id}/team-test`, { teamTest });
      res.json({ success: true, data: payload });
    } catch (error: any) {
      logger.error('Mark refund team test error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update refund transaction type',
      });
    }
  }

  static async listRefunds(req: Request, res: Response): Promise<void> {
    try {
      const requestedLimit = Math.min(Number((req.query as any).limit) || 10, 200);
      const requestedOffset = Number((req.query as any).offset) || 0;
      const transactionType = (req.query as any).transactionType as string | undefined;
      const params: Record<string, any> = {
        ...(req.query as Record<string, any>),
      };
      if (transactionType === 'all') {
        delete params.transactionType;
      }

      const data = await safeGet<any>(
        '/api/v1/dashboard/refunds',
        params,
        { success: true, items: [], total: 0 }
      );

      const rawRows = data.refunds ?? data.items ?? [];
      const uniqueCustomerUids = new Set<string>();
      rawRows.forEach((row: any) => {
        const customerUid = row.CustomerUid || row.escrow?.posterUid || row.customerUid || row.posterUid;
        if (customerUid) uniqueCustomerUids.add(customerUid);
      });

      const customerNameByUid = new Map<string, string>();
      if (uniqueCustomerUids.size > 0) {
        try {
          const profilesResult = await userServiceClient.getProfilesBatchByUids(Array.from(uniqueCustomerUids));
          const profiles = profilesResult?.profiles ?? [];
          profiles.forEach((profile: any) => {
            const customerName =
              profile?.name ||
              [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
            if (profile?.uid) {
              customerNameByUid.set(profile.uid, customerName);
            }
          });
        } catch (err) {
          logger.warn('Batch refund customer resolution failed, falling back to raw values');
        }
      }

      const rows = rawRows.map((row: any) => {
        const customerUid = row.CustomerUid || row.escrow?.posterUid || row.customerUid || row.posterUid || null;
        const customerName =
          String(row.customerName || row.CustomerName || customerNameByUid.get(customerUid || '') || '').trim();
        const rawTeamTest =
          typeof row.teamTest === 'boolean'
            ? row.teamTest
            : typeof row.metadata?.teamTest === 'boolean'
            ? row.metadata.teamTest
            : false;
        const teamTest = rawTeamTest || customerName.toLowerCase() === 'allam test';

        return {
          refundId: row.refundId,
          paymentId: row.paymentId,
          taskId: row.taskId,
          CustomerUid: row.CustomerUid || row.escrow?.posterUid || null,
          performerUid: row.performerUid,
          refundAmount: String(row.refundAmount ?? ''),
          status: row.status,
          createdAt: row.createdAt,
          teamTest,
        };
      });

      const total = data.pagination?.total ?? data.total ?? rows.length;
      res.json({
        success: true,
        data: rows,
        total: total,
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

  static async deleteTransaction(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = await paymentServiceClient.delete(`/api/v1/dashboard/transactions/${encodeURIComponent(id)}`);
      res.json(data);
    } catch (error: any) {
      logger.error('Delete transaction error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to delete transaction',
      });
    }
  }

  static async deletePayout(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = await paymentServiceClient.delete(`/api/v1/dashboard/payouts/${encodeURIComponent(id)}`);
      res.json(data);
    } catch (error: any) {
      logger.error('Delete payout error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to delete payout',
      });
    }
  }

  static async deleteRefund(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = await paymentServiceClient.delete(`/api/v1/dashboard/refunds/${encodeURIComponent(id)}`);
      res.json(data);
    } catch (error: any) {
      logger.error('Delete refund error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to delete refund',
      });
    }
  }
}

