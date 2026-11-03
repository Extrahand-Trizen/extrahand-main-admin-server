import { Request, Response } from 'express';
import { z } from 'zod';
import { AxiosError } from 'axios';
import logger from '../config/logger';
import { paymentServiceClient } from '../services/PaymentServiceClient';
import { getClientSafeStatus } from '../utils/upstreamHttp';

const categoryKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const feeCategorySchema = z.object({
  mode: z.enum(['BIDDING', 'BOOK_NOW']),
  displayName: z.string().trim().max(120).nullable().optional(),
  sacCode: z.string().trim().max(32).nullable().optional(),
  sacHeading: z.string().trim().max(200).nullable().optional(),
  gstPercentage: z.number().min(0).max(1),
  platformFeePercentage: z.number().min(0).max(1).nullable(),
});

export class FeeManagementController {
  static async list(req: Request, res: Response): Promise<void> {
    const mode = z.enum(['BIDDING', 'BOOK_NOW']).safeParse(req.query.mode);
    if (!mode.success) {
      res.status(400).json({ success: false, error: 'mode must be BIDDING or BOOK_NOW' });
      return;
    }

    try {
      const response = await paymentServiceClient.get('/api/v1/fees/categories', {
        mode: mode.data,
      });
      res.status(200).json(response);
    } catch (error) {
      FeeManagementController.respondWithUpstreamError(error, res, 'list fee categories');
    }
  }

  static async upsert(req: Request, res: Response): Promise<void> {
    const categoryKey = categoryKeySchema.safeParse(req.params.categoryKey);
    const body = feeCategorySchema.safeParse(req.body);
    if (!categoryKey.success || !body.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid category key or fee configuration',
        details: body.success ? undefined : body.error.flatten(),
      });
      return;
    }

    try {
      const response = await paymentServiceClient.put(
        `/api/v1/fees/categories/${encodeURIComponent(categoryKey.data)}`,
        { ...body.data, categoryKey: categoryKey.data },
      );
      res.status(200).json(response);
    } catch (error) {
      FeeManagementController.respondWithUpstreamError(error, res, 'save fee category');
    }
  }

  static async remove(req: Request, res: Response): Promise<void> {
    const categoryKey = categoryKeySchema.safeParse(req.params.categoryKey);
    const mode = z.enum(['BIDDING', 'BOOK_NOW']).safeParse(req.query.mode);
    if (!categoryKey.success || !mode.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid category key or fee mode',
      });
      return;
    }

    try {
      const response = await paymentServiceClient.delete(
        `/api/v1/fees/categories/${encodeURIComponent(categoryKey.data)}?mode=${mode.data}`,
      );
      res.status(200).json(response);
    } catch (error) {
      FeeManagementController.respondWithUpstreamError(error, res, 'delete fee category');
    }
  }

  private static respondWithUpstreamError(
    error: unknown,
    res: Response,
    action: string,
  ): void {
    const axiosError = error as AxiosError<{ error?: string; message?: string }>;
    const status = axiosError.response ? getClientSafeStatus(error) : 502;
    const body = axiosError.response?.data;
    logger.error(`Fee management failed to ${action}`, {
      status,
      message: axiosError.message,
    });
    res.status(status).json(
      body || { success: false, error: `Unable to ${action}; payment service is unavailable` },
    );
  }
}
