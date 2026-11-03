import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { serviceCatalogClient } from '../services/ServiceCatalogClient';
import { minioService } from '../services/MinioService';
import logger from '../config/logger';

async function forward(fn: () => Promise<unknown>, res: Response, action: string) {
  try {
    return res.status(200).json(await fn());
  } catch (error: any) {
    const status = error.response?.status || 500;
    const body = error.response?.data || {
      success: false,
      message: `${action} failed: ${error.message}`,
    };
    return res.status(status).json(body);
  }
}

export class ServiceCatalogController {
  static async list(_req: Request, res: Response) {
    return forward(() => serviceCatalogClient.listServices(), res, 'List services');
  }

  static async listBookNowLocationAvailability(req: Request, res: Response) {
    return forward(
      () =>
        serviceCatalogClient.listBookNowLocationAvailability({
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          type: typeof req.query.type === 'string' ? req.query.type : undefined,
          isEnabled: typeof req.query.isEnabled === 'string'
            ? req.query.isEnabled === 'true'
            : undefined,
          catalogId: typeof req.query.catalogId === 'string'
            ? req.query.catalogId
            : undefined,
        }),
      res,
      'List Book Now location availability',
    );
  }

  static async updateBookNowLocationAvailability(req: Request, res: Response) {
    if (typeof req.body?.isEnabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isEnabled must be a boolean' });
    }
    return forward(
      () =>
        serviceCatalogClient.updateBookNowLocationAvailability(
          String(req.params.type),
          String(req.params.id),
          req.body.isEnabled,
          typeof req.body.catalogId === 'string'
            ? req.body.catalogId
            : undefined,
        ),
      res,
      'Update Book Now location availability',
    );
  }

  static async removeBookNowLocation(req: Request, res: Response) {
    return forward(
      () =>
        serviceCatalogClient.removeBookNowLocation(
          String(req.params.type),
          String(req.params.id),
        ),
      res,
      'Remove Book Now location',
    );
  }

  static async create(req: Request, res: Response) {
    return forward(
      () => serviceCatalogClient.createService(req.body),
      res,
      'Create service',
    );
  }

  static async update(req: Request, res: Response) {
    return forward(
      () => serviceCatalogClient.updateService(String(req.params.id), req.body),
      res,
      'Update service',
    );
  }

  static async updateStatus(req: Request, res: Response) {
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive must be a boolean' });
    }
    return forward(
      () => serviceCatalogClient.updateServiceStatus(String(req.params.id), req.body.isActive),
      res,
      'Update service status',
    );
  }

  static async updateImage(req: Request, res: Response) {
    return forward(
      () => serviceCatalogClient.updateServiceImage(String(req.params.id), String(req.body?.imageUrl || '')),
      res,
      'Update service image',
    );
  }

  static async updateOffer(req: Request, res: Response) {
    const rawOfferPrice = req.body?.offerPrice;
    if (rawOfferPrice !== null && (typeof rawOfferPrice !== 'number' || !Number.isFinite(rawOfferPrice))) {
      return res.status(400).json({ success: false, error: 'offerPrice must be a positive number or null' });
    }
    return forward(
      () => serviceCatalogClient.updateServiceOffer(String(req.params.id), rawOfferPrice),
      res,
      'Update service offer',
    );
  }

  static async uploadImage(req: Request, res: Response) {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file uploaded' });
    }

    try {
      const extensionByMimeType: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      };
      const extension = extensionByMimeType[req.file.mimetype];
      if (!extension) {
        return res.status(400).json({ success: false, error: 'Only JPG, PNG or WebP images are allowed' });
      }

      const key = `service-catalog/${Date.now()}-${randomUUID()}.${extension}`;
      const url = await minioService.uploadPublicFile(key, req.file.buffer, req.file.mimetype);
      return res.json({ success: true, data: { url, key } });
    } catch (error) {
      logger.error('Failed to upload service catalog image', error);
      return res.status(500).json({ success: false, error: 'Failed to upload service image' });
    }
  }
}
