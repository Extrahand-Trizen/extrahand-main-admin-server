import { Request, Response } from 'express';
import { userServiceClient } from '../services/UserServiceClient';
import logger from '../config/logger';

export class PartnerCategoryRequestController {
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const result = await userServiceClient.listPartnerCategoryRequests({
        status: req.query.status as string | undefined,
        page: req.query.page === undefined ? undefined : Number(req.query.page),
        limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
        search: req.query.search as string | undefined,
        requestedCategory: req.query.requestedCategory as string | undefined,
        currentCategory: req.query.currentCategory as string | undefined,
        city: req.query.city as string | undefined,
      }, req.admin?.userId);
      res.status(200).json(result);
    } catch (error: any) {
      logger.error('Failed to list partner category requests', { error: error.message });
      res.status(error.response?.status || 502).json(
        error.response?.data || { success: false, error: 'Failed to list partner category requests' },
      );
    }
  }

  static async review(req: Request, res: Response): Promise<void> {
    try {
      const result = await userServiceClient.reviewPartnerCategoryRequest(
        req.params.requestId,
        req.body,
        req.admin!.userId,
      );
      res.status(200).json(result);
    } catch (error: any) {
      logger.error('Failed to review partner category request', {
        requestId: req.params.requestId,
        error: error.message,
      });
      res.status(error.response?.status || 502).json(
        error.response?.data || { success: false, error: 'Failed to review partner category request' },
      );
    }
  }
}
