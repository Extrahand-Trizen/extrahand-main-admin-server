import { Request, Response } from 'express';
import { userServiceClient } from '../services/UserServiceClient';
import logger from '../config/logger';

async function forward(
  action: string,
  res: Response,
  request: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await request();
    res.status(200).json(result);
  } catch (error: any) {
    logger.error(`Partner category catalog ${action} failed`, {
      error: error.message,
      categoryId: error.config?.url,
    });
    res.status(error.response?.status || 502).json(
      error.response?.data || { success: false, error: `Failed to ${action} partner category catalog` },
    );
  }
}

export class PartnerCategoryCatalogController {
  static async list(req: Request, res: Response): Promise<void> {
    await forward('list', res, () =>
      userServiceClient.listPartnerCategories(req.query.includeInactive === 'true'),
    );
  }

  static async create(req: Request, res: Response): Promise<void> {
    await forward('create', res, () => userServiceClient.createPartnerCategory(req.body));
  }

  static async update(req: Request, res: Response): Promise<void> {
    await forward('update', res, () =>
      userServiceClient.updatePartnerCategory(String(req.params.categoryId), req.body),
    );
  }

  static async setActive(req: Request, res: Response): Promise<void> {
    await forward('update status', res, () =>
      userServiceClient.setPartnerCategoryActive(
        String(req.params.categoryId),
        req.body?.isActive,
      ),
    );
  }
}
