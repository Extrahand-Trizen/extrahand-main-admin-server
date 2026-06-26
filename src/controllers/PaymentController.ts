import { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import logger from '../config/logger';
import { prismaPayment, prismaPaymentDev } from '../config/prismaPayment';
import { paymentServiceClient } from '../services/PaymentServiceClient';
import { getClientSafeStatus } from '../utils/upstreamHttp';
import { enrichEntities } from '../utils/enrichment';

// ─────────────────────────────────────────────────────────────────────────────
// safeGet — still used for write-adjacent reads (overview, bank accounts)
// that need payment-service business logic
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function parseLimit(val: unknown, def = 10, max = 500): number {
  const n = Number(val);
  return isNaN(n) ? def : Math.min(Math.max(n, 1), max);
}
function parseOffset(val: unknown): number {
  const n = Number(val);
  return isNaN(n) || n < 0 ? 0 : n;
}
function toStr(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Pick the correct Prisma client based on ?environment= query param */
function selectDb(environment: unknown): PrismaClient | null {
  if (environment === 'development') {
    return prismaPaymentDev || null;
  }
  return prismaPayment || null;
}

/** Detect team-test transactions from metadata JSONB */
function isTeamTest(meta: any): boolean {
  if (!meta) return false;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { return false; }
  }
  return meta?.teamTest === true || meta?.isTeamTest === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildEscrowQuery — raw SQL with COUNT(*) OVER() for single round-trip pagination
// Mirrors the same function in extrahand-payment-service AdminFinanceController
// ─────────────────────────────────────────────────────────────────────────────
function buildEscrowQuery(
  where: Prisma.EscrowWhereInput,
  limit: number,
  offset: number
): { sql: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (where.status && typeof where.status === 'string') {
    conditions.push(`"status" = $${idx++}`);
    params.push(where.status);
  }

  const createdAt = where.createdAt as { gte?: Date; lte?: Date } | undefined;
  if (createdAt) {
    if (createdAt.gte) {
      conditions.push(`"createdAt" >= $${idx++}`);
      params.push(createdAt.gte);
    }
    if (createdAt.lte) {
      conditions.push(`"createdAt" <= $${idx++}`);
      params.push(createdAt.lte);
    }
  }

  const orClauses = where.OR as Array<Record<string, any>> | undefined;
  if (orClauses && orClauses.length > 0) {
    const orParts: string[] = [];
    for (const clause of orClauses) {
      for (const [col, val] of Object.entries(clause)) {
        if (val && typeof val === 'object' && 'contains' in val) {
          orParts.push(`"${col}"::text ILIKE $${idx++}`);
          params.push(`%${val.contains}%`);
        }
      }
    }
    if (orParts.length > 0) {
      conditions.push(`(${orParts.join(' OR ')})`);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT id, "escrowId", "transactionId", "razorpayOrderId", "taskId", "taskCategory",
           "applicationId", "posterUid", "performerUid", "bookingOrderId", amount, currency,
           "amountInRupees", "taskAmount", status, "razorpayPaymentId", "paymentStatus",
           "autoReleaseDate", "heldAt", "releasedAt", "refundedAt", "errorMessage",
           "errorCode", metadata, "createdAt", "updatedAt",
           COUNT(*) OVER() AS _total_count
    FROM   "Escrow"
    ${whereClause}
    ORDER  BY "createdAt" DESC
    LIMIT  $${idx++} OFFSET $${idx++}
  `;
  params.push(limit, offset);

  return { sql, params };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment helpers — shared across listTransactions
// ─────────────────────────────────────────────────────────────────────────────
async function enrichTransactions(rawTransactions: any[]) {
  const uniqueTaskIds: string[] = [];
  const userUids: string[] = [];

  rawTransactions.forEach((row: any) => {
    if (row.taskId) uniqueTaskIds.push(row.taskId);
    if (row.posterUid || row.CustomerUid) userUids.push(row.posterUid || row.CustomerUid);
    if (row.performerUid) userUids.push(row.performerUid);
  });

  return enrichEntities(uniqueTaskIds, userUids, true);
}

// ─────────────────────────────────────────────────────────────────────────────
export class PaymentController {
// ─────────────────────────────────────────────────────────────────────────────

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
            successRate: typeof o.paymentSuccessRate === 'number' ? o.paymentSuccessRate / 100 : 0,
          },
          alerts: [
            { type: 'failed_payout_spike', count: counts.failedPayoutsNoRetry ?? 0, windowHours: 24 },
            { type: 'pending_payouts', count: counts.pendingJobQueuePayouts ?? 0, windowHours: 24 },
            { type: 'escrows_held_too_long', count: counts.escrowsHeldTooLong ?? 0, windowHours: 168 },
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

  // ── READ: listTransactions — direct Prisma, no payment service HTTP hop ─────
  static async listTransactions(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseLimit(req.query.limit, 10, 500);
      const offset = parseOffset(req.query.offset);
      const transactionType = typeof req.query.transactionType === 'string' ? req.query.transactionType : undefined;
      const holdStatus = typeof req.query.holdStatus === 'string' ? req.query.holdStatus : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
      const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
      const db = selectDb(req.query.environment);

      if (!db) {
        res.json({ success: true, data: [], total: 0 });
        return;
      }

      // Build where clause
      const where: Prisma.EscrowWhereInput = {};
      if (status && status !== 'all') where.status = status;
      if (holdStatus) where.status = holdStatus;

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
      }

      if (q) {
        where.OR = [
          { escrowId: { contains: q, mode: 'insensitive' } },
          { razorpayOrderId: { contains: q, mode: 'insensitive' } },
          { razorpayPaymentId: { contains: q, mode: 'insensitive' } },
          { taskId: { contains: q, mode: 'insensitive' } },
          { posterUid: { contains: q, mode: 'insensitive' } },
          { performerUid: { contains: q, mode: 'insensitive' } },
        ];
      }

      console.time('rawUnsafe-escrows');
      const query = buildEscrowQuery(where, limit, offset);
      const raw: any[] = await db.$queryRawUnsafe(query.sql, ...query.params);
      console.timeEnd('rawUnsafe-escrows');

      const total = raw.length > 0 ? Number(raw[0]._total_count) : 0;

      // Map and safely parse metadata, removing _total_count to avoid bigint serialize issues
      let slicedRows = raw.map((r: any) => {
        const { _total_count, ...rest } = r;
        return {
          ...rest,
          metadata: typeof rest.metadata === 'string' ? JSON.parse(rest.metadata) : (rest.metadata ?? null),
        };
      });

      // Apply transactionType filter in JS (avoids Prisma JSONB NOT null-propagation bug)
      if (transactionType === 'real') {
        slicedRows = slicedRows.filter((r: any) => !isTeamTest(r.metadata));
      } else if (transactionType === 'team') {
        slicedRows = slicedRows.filter((r: any) => isTeamTest(r.metadata));
      }

      // Fetch payout amounts for ONLY the sliced rows (fast, DB-only)
      const escrowDbIds = slicedRows.map((r: any) => r.id).filter(Boolean);
      const payoutMap = escrowDbIds.length > 0
        ? await db.payout.findMany({
            where: { escrowId: { in: escrowDbIds } },
            select: { escrowId: true, netAmount: true, performerUid: true, status: true },
          }).then((rows: { escrowId: string | null; netAmount: any; performerUid: any; status: any }[]) => {
            const m = new Map<string, any>();
            rows.forEach((p: { escrowId: string | null }) => { if (p.escrowId) m.set(p.escrowId, p); });
            return m;
          }).catch(() => new Map<string, any>())
        : new Map<string, any>();

      const transactions = slicedRows.map((row: any) => {
        const payout = payoutMap.get(row.id);
        const posterUid = row.posterUid || row.CustomerUid;
        const performerUid = row.performerUid || 'pending_assignment';

        let payoutAmount: string | null = null;
        if (payout) {
          payoutAmount = toStr(payout.netAmount);
        } else if (row.taskAmount != null) {
          try {
            const taskAmt = Number(row.taskAmount);
            const commission = taskAmt * 0.05;
            const gstOnCommission = commission * 0.18;
            const netAmt = taskAmt - commission - gstOnCommission;
            payoutAmount = netAmt.toFixed(2);
          } catch { /* ignore */ }
        }

        return {
          id: row.id,
          escrowId: row.escrowId,
          razorpayOrderId: row.razorpayOrderId,
          razorpayPaymentId: row.razorpayPaymentId,
          taskId: row.taskId,
          applicationId: row.applicationId,
          posterUid,
          performerUid,
          status: row.status,
          paymentStatus: row.paymentStatus,
          amountInRupees: toStr(row.amountInRupees),
          payoutAmount,
          createdAt: row.createdAt,
          teamTest: isTeamTest(row.metadata),
          links: {
            customerUserId: posterUid,
            helperUserId: performerUid,
            taskId: row.taskId,
            customerName: posterUid,
            taskTitle: row.taskId,
            helperName: performerUid,
          },
        };
      });

      res.json({ success: true, data: transactions, total });
    } catch (error: any) {
      logger.error('List transactions error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list transactions',
      });
    }
  }

  // ── READ: enrichTransactionsBatch — batch user/task enrichment for visible rows ─
  // Called by frontend after listTransactions renders, so the list endpoint
  // returns immediately without waiting for external service calls.
  // POST /api/v1/payments/transactions/enrich
  static async enrichTransactionsBatch(req: Request, res: Response): Promise<void> {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.json({ success: true, data: {} });
        return;
      }

      const db = selectDb(req.query.environment);
      if (!db) {
        res.json({ success: true, data: {} });
        return;
      }

      // Fetch escrow rows by primary key to get taskId, posterUid, performerUid
      const rows = await db.escrow.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          escrowId: true,
          taskId: true,
          posterUid: true,
          performerUid: true,
          metadata: true,
        },
      });

      // Run enrichment (task service + user service calls)
      const enrichment = await enrichTransactions(rows);
      const { userCache, taskTitleCache, taskAssigneeCache = new Map() } = enrichment;

      const data: Record<string, any> = {};
      for (const row of rows) {
        const posterUid = row.posterUid;
        const performerUid = row.performerUid !== 'pending_assignment'
          ? row.performerUid
          : (taskAssigneeCache.get(row.taskId) || undefined);

        const customer = posterUid ? (userCache.get(posterUid) || {}) : {};
        const helper = performerUid ? (userCache.get(performerUid) || {}) : {};
        const taskTitle = row.taskId ? taskTitleCache.get(row.taskId) : null;

        const customerName = customer.name || null;
        const helperName = helper.name || null;
        const teamTest = (customerName?.toLowerCase() === 'allam test') || isTeamTest(row.metadata);

        data[row.id] = {
          customerUserId: customer.userId || posterUid,
          helperUserId: helper.userId || performerUid || 'pending_assignment',
          customerName,
          helperName,
          taskTitle,
          teamTest,
        };
      }

      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Enrich transactions error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to enrich transactions',
      });
    }
  }

  // ── WRITE: keep going through payment service ─────────────────────────────
  static async markTransactionTeamTest(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const payload = await paymentServiceClient.patch(`/api/v1/dashboard/transactions/${id}/team-test`, req.body);
      res.json({ success: true, data: payload });
    } catch (error: any) {
      logger.error('Mark transaction team test error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update transaction type',
      });
    }
  }

  static async updatePayoutStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const payload = await paymentServiceClient.patch(`/api/v1/dashboard/payouts/${id}/status`, req.body);
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
      if (!id) throw new Error('Payout id is required');
      if (typeof teamTest !== 'boolean') throw new Error('teamTest must be a boolean');
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

  // ── READ: listPayouts — direct Prisma ─────────────────────────────────────
  static async listPayouts(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseLimit(req.query.limit, 10, 200);
      const offset = parseOffset(req.query.offset);
      const transactionType = typeof req.query.transactionType === 'string' ? req.query.transactionType : undefined;
      const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
      const db = selectDb(req.query.environment);

      if (!db) {
        res.json({ success: true, data: [], total: 0 });
        return;
      }

      const where: Prisma.PayoutWhereInput = {};
      if (status && status !== 'all') where.status = status;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
      }
      if (q) {
        where.OR = [
          { payoutId: { contains: q, mode: 'insensitive' } },
          { performerUid: { contains: q, mode: 'insensitive' } },
          { escrow: { taskId: { contains: q, mode: 'insensitive' } } },
        ];
      }

      // Fetch count and page in parallel — database pagination
      const [total, payoutRows] = await Promise.all([
        db.payout.count({ where }),
        db.payout.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: { escrow: { select: { posterUid: true, taskId: true, metadata: true } } },
        }),
      ]);

      // Apply transactionType filter in JS (avoids Prisma JSONB NOT null-propagation bug)
      let filteredRows = payoutRows;
      if (transactionType === 'real') {
        filteredRows = payoutRows.filter((r: any) => !isTeamTest(r.metadata) && !isTeamTest(r.escrow?.metadata));
      } else if (transactionType === 'team') {
        filteredRows = payoutRows.filter((r: any) => isTeamTest(r.metadata) || isTeamTest(r.escrow?.metadata));
      }

      // No enrichment — list endpoint returns immediately with DB-only data.
      // Frontend calls POST /api/v1/payments/payouts/enrich for lazy enrichment.
      const rows = filteredRows.map((row: any) => {
        const customerUid = row.escrow?.posterUid || null;
        const teamTest = isTeamTest(row.metadata) || isTeamTest(row.escrow?.metadata);

        return {
          id: row.id,
          payoutId: row.payoutId,
          performerUid: row.performerUid,
          taskId: row.taskId || row.escrow?.taskId || null,
          CustomerUid: customerUid,
          amount: toStr(row.amount),
          netAmount: toStr(row.netAmount),
          status: row.status,
          source: row.source || row.type || null,
          type: row.type || null,
          createdAt: row.createdAt,
          teamTest,
          links: {
            customerUserId: customerUid,
            helperUserId: row.performerUid,
            customerName: customerUid || '',
            helperName: row.performerUid || '',
            taskTitle: row.taskId || row.escrow?.taskId || null,
          }
        };
      });

      res.json({ success: true, data: rows, total });
    } catch (error: any) {
      logger.error('List payouts error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list payouts',
      });
    }
  }

  // ── READ: enrichPayoutsBatch — lazy enrichment for visible payout rows ──────
  // POST /api/v1/payments/payouts/enrich
  static async enrichPayoutsBatch(req: Request, res: Response): Promise<void> {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.json({ success: true, data: {} });
        return;
      }

      const db = selectDb(req.query.environment);
      if (!db) {
        res.json({ success: true, data: {} });
        return;
      }

      const rows = await db.payout.findMany({
        where: { id: { in: ids } },
        include: { escrow: { select: { posterUid: true, taskId: true, metadata: true } } },
      });

      const taskIds: string[] = [];
      const userUids: string[] = [];
      for (const row of rows) {
        const taskId = row.taskId || row.escrow?.taskId;
        if (taskId) taskIds.push(taskId);
        const customerUid = row.escrow?.posterUid || null;
        if (customerUid) userUids.push(customerUid);
        if (row.performerUid) userUids.push(row.performerUid);
      }

      const { userCache, taskTitleCache } = await enrichEntities(taskIds, userUids);

      const data: Record<string, any> = {};
      for (const row of rows) {
        const customerUid = row.escrow?.posterUid || null;
        const customer = customerUid ? (userCache.get(customerUid) || {}) : {};
        const helper = row.performerUid ? (userCache.get(row.performerUid) || {}) : {};
        const taskIdKey = (row.taskId || row.escrow?.taskId || '') as string;
        const taskTitle = taskIdKey ? taskTitleCache.get(taskIdKey) || null : null;
        const customerName = customer.name || null;
        const helperName = helper.name || null;
        const teamTest = isTeamTest(row.escrow?.metadata) || (customerName?.toLowerCase() === 'allam test');

        data[row.id] = {
          customerUserId: customer.userId || customerUid,
          helperUserId: helper.userId || row.performerUid,
          customerName,
          helperName,
          taskTitle,
          teamTest,
        };
      }

      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Enrich payouts error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to enrich payouts',
      });
    }
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────
  static async markRefundTeamTest(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { teamTest } = req.body || {};
      if (!id) throw new Error('Refund id is required');
      if (typeof teamTest !== 'boolean') throw new Error('teamTest must be a boolean');
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

  // ── READ: listRefunds — direct Prisma ─────────────────────────────────────
  static async listRefunds(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseLimit(req.query.limit, 10, 200);
      const offset = parseOffset(req.query.offset);
      const transactionType = typeof req.query.transactionType === 'string' ? req.query.transactionType : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
      const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
      const db = selectDb(req.query.environment);

      if (!db) {
        res.json({ success: true, data: [], total: 0 });
        return;
      }

      const where: Prisma.RefundWhereInput = {};
      if (status && status !== 'all') where.status = status;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
      }
      if (q) {
        where.OR = [
          { refundId: { contains: q, mode: 'insensitive' } },
          { paymentId: { contains: q, mode: 'insensitive' } },
          { escrow: { taskId: { contains: q, mode: 'insensitive' } } },
        ];
      }

      // Fetch count and page in parallel — database pagination
      const [total, refundRows] = await Promise.all([
        db.refund.count({ where }),
        db.refund.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: { escrow: { select: { posterUid: true, performerUid: true, taskId: true, metadata: true } } },
        }),
      ]);

      // Apply transactionType filter in JS (avoids Prisma JSONB NOT null-propagation bug)
      let filteredRows = refundRows;
      if (transactionType === 'real') {
        filteredRows = refundRows.filter((r: any) => !isTeamTest(r.escrow?.metadata));
      } else if (transactionType === 'team') {
        filteredRows = refundRows.filter((r: any) => isTeamTest(r.escrow?.metadata));
      }

      // No enrichment — list endpoint returns immediately with DB-only data.
      // Frontend calls POST /api/v1/payments/refunds/enrich for lazy enrichment.
      const rows = filteredRows.map((row: any) => {
        const customerUid = row.escrow?.posterUid || null;
        const performerUid = row.escrow?.performerUid || null;
        const teamTest = isTeamTest(row.escrow?.metadata);

        return {
          id: row.id,
          refundId: row.refundId,
          paymentId: row.paymentId,
          taskId: row.taskId || row.escrow?.taskId || null,
          CustomerUid: customerUid,
          performerUid: performerUid,
          refundAmount: toStr(row.refundAmount),
          status: row.status,
          createdAt: row.createdAt,
          teamTest,
          links: {
            customerUserId: customerUid,
            helperUserId: performerUid,
            customerName: customerUid || '',
            helperName: performerUid || '',
            taskTitle: row.taskId || row.escrow?.taskId || null,
          }
        };
      });

      res.json({ success: true, data: rows, total });
    } catch (error: any) {
      logger.error('List refunds error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list refunds',
      });
    }
  }

  // ── READ: enrichRefundsBatch — lazy enrichment for visible refund rows ──────
  // POST /api/v1/payments/refunds/enrich
  static async enrichRefundsBatch(req: Request, res: Response): Promise<void> {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.json({ success: true, data: {} });
        return;
      }

      const db = selectDb(req.query.environment);
      if (!db) {
        res.json({ success: true, data: {} });
        return;
      }

      const rows = await db.refund.findMany({
        where: { id: { in: ids } },
        include: { escrow: { select: { posterUid: true, performerUid: true, taskId: true, metadata: true } } },
      });

      const taskIds: string[] = [];
      const userUids: string[] = [];
      for (const row of rows) {
        const taskId = row.taskId || row.escrow?.taskId;
        if (taskId) taskIds.push(taskId);
        const customerUid = row.escrow?.posterUid || null;
        if (customerUid) userUids.push(customerUid);
        const performerUid = row.escrow?.performerUid || null;
        if (performerUid) userUids.push(performerUid);
      }

      const { userCache, taskTitleCache } = await enrichEntities(taskIds, userUids);

      const data: Record<string, any> = {};
      for (const row of rows) {
        const customerUid = row.escrow?.posterUid || null;
        const performerUid = row.escrow?.performerUid || null;
        const customer = customerUid ? (userCache.get(customerUid) || {}) : {};
        const helper = performerUid ? (userCache.get(performerUid) || {}) : {};
        const taskIdKey = (row.taskId || row.escrow?.taskId || '') as string;
        const taskTitle = taskIdKey ? taskTitleCache.get(taskIdKey) || null : null;
        const customerName = customer.name || null;
        const helperName = helper.name || null;
        const teamTest = isTeamTest(row.escrow?.metadata) || (customerName?.toLowerCase() === 'allam test');

        data[row.id] = {
          customerUserId: customer.userId || customerUid,
          helperUserId: helper.userId || performerUid,
          customerName,
          helperName,
          taskTitle,
          teamTest,
        };
      }

      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Enrich refunds error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to enrich refunds',
      });
    }
  }

  // ── READ: listLedger — direct Prisma ──────────────────────────────────────
  static async listLedger(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseLimit(req.query.limit, 10, 200);
      const offset = parseOffset(req.query.offset);
      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const escrowId = typeof req.query.escrowId === 'string' ? req.query.escrowId : undefined;
      const payoutId = typeof req.query.payoutId === 'string' ? req.query.payoutId : undefined;
      const refundId = typeof req.query.refundId === 'string' ? req.query.refundId : undefined;
      const db = selectDb(req.query.environment);

      if (!db) {
        res.json({ success: true, data: [], total: 0 });
        return;
      }

      const where: Prisma.LedgerWhereInput = {};
      if (type && type !== 'all') where.type = type;
      if (escrowId) where.escrowId = escrowId;
      if (payoutId) where.payoutId = payoutId;
      if (refundId) where.refundId = refundId;

      const [total, ledgerRows] = await Promise.all([
        db.ledger.count({ where }),
        db.ledger.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            payout: { select: { performerUid: true } },
            escrow: { select: { posterUid: true } },
          },
        }),
      ]);

      // No enrichment — list endpoint returns immediately with DB-only data.
      // Frontend calls POST /api/v1/payments/ledger/enrich for lazy enrichment.
      const rows = ledgerRows.map((row: any) => {
        const customerUid = row.userId || row.escrow?.posterUid || null;
        const performerUid = row.payout?.performerUid || null;

        return {
          ...row,
          id: row.id,
          CustomerUid: customerUid,
          performerUid: performerUid,
          links: {
            customerUserId: customerUid,
            helperUserId: performerUid,
            customerName: customerUid || '',
            helperName: performerUid || '',
            taskTitle: row.taskId || null,
          }
        };
      });

      res.json({ success: true, data: rows, total });
    } catch (error: any) {
      logger.error('List ledger error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list ledger',
      });
    }
  }

  // ── READ: enrichLedgerBatch — lazy enrichment for visible ledger rows ───────
  // POST /api/v1/payments/ledger/enrich
  static async enrichLedgerBatch(req: Request, res: Response): Promise<void> {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.json({ success: true, data: {} });
        return;
      }

      const db = selectDb(req.query.environment);
      if (!db) {
        res.json({ success: true, data: {} });
        return;
      }

      const rows = await db.ledger.findMany({
        where: { id: { in: ids } },
        include: {
          payout: { select: { performerUid: true } },
          escrow: { select: { posterUid: true } },
        },
      });

      const taskIds: string[] = [];
      const userUids: string[] = [];
      for (const row of rows) {
        if (row.taskId) taskIds.push(row.taskId);
        const customerUid = row.userId || row.escrow?.posterUid || null;
        if (customerUid) userUids.push(customerUid);
        const performerUid = row.payout?.performerUid || null;
        if (performerUid) userUids.push(performerUid);
      }

      const { userCache, taskTitleCache } = await enrichEntities(taskIds, userUids);

      const data: Record<string, any> = {};
      for (const row of rows) {
        const customerUid = row.userId || row.escrow?.posterUid || null;
        const performerUid = row.payout?.performerUid || null;
        const customer = customerUid ? (userCache.get(customerUid) || {}) : {};
        const helper = performerUid ? (userCache.get(performerUid) || {}) : {};
        const taskTitle = row.taskId ? taskTitleCache.get(row.taskId) : null;

        data[row.id] = {
          customerUserId: customer.userId || customerUid,
          helperUserId: helper.userId || performerUid,
          customerName: customer.name || null,
          helperName: helper.name || null,
          taskTitle: taskTitle || null,
        };
      }

      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Enrich ledger error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to enrich ledger',
      });
    }
  }

  // ── READ: getUserBankAccounts — stays in payment service (decryption logic) ─
  static async getUserBankAccounts(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!id) throw new Error('User id is required');
      const data = await safeGet<any>(
        `/api/v1/admin/users/${id}/financial-profile`,
        undefined,
        { success: true, bankAccounts: [] }
      );
      res.json({ success: true, data: { bankAccounts: data?.bankAccounts ?? [] } });
    } catch (error: any) {
      logger.error('Get user bank accounts error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch user bank accounts',
      });
    }
  }

  // ── WRITE: deletes go through payment service ─────────────────────────────
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
