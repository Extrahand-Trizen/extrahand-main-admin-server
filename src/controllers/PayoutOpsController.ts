import { Request, Response } from 'express';
import { paymentServiceClient } from '../services/PaymentServiceClient';
import logger from '../config/logger';

export class PayoutOpsController {
  /**
   * GET /api/v1/payouts/ops/manual-queue
   * Proxy to payment-service — payout requests awaiting manual bank transfer.
   */
  static async listManualOpsQueue(req: Request, res: Response): Promise<void> {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : 'processing';
      const limit =
        typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const offset =
        typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined;

      const data = await paymentServiceClient.listManualOpsPayoutQueue({
        status,
        limit: Number.isFinite(limit) ? limit : undefined,
        offset: Number.isFinite(offset) ? offset : undefined,
      });

      res.json(data);
    } catch (error: any) {
      logger.error('Failed to list manual ops payout queue', {
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
      });
      res.status(error?.response?.status || 502).json({
        success: false,
        error:
          error?.response?.data?.error ||
          error?.message ||
          'Failed to load payout queue from payment service',
      });
    }
  }
}
