import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { bannerClient } from '../services/BannerClient';
import { minioService } from '../services/MinioService';

async function forward(fn: () => Promise<any>, res: Response, action: string) {
  try {
    const data = await fn();
    return res.status(200).json(data);
  } catch (error: any) {
    const status = error.response?.status || 500;
    const body = error.response?.data || { success: false, message: `${action} failed: ${error.message}` };
    return res.status(status).json(body);
  }
}

export class BannerController {
  static async listBanners(req: Request, res: Response) {
    const placement = typeof req.query.placement === 'string' ? req.query.placement : undefined;
    return forward(() => bannerClient.listBanners({ placement }), res, 'List banners');
  }

  static async getBannerById(req: Request, res: Response) {
    return forward(() => bannerClient.getBannerById(String(req.params.id)), res, 'Get banner');
  }

  static async createBanner(req: Request, res: Response) {
    return forward(() => bannerClient.createBanner(req.body), res, 'Create banner');
  }

  static async updateBanner(req: Request, res: Response) {
    return forward(() => bannerClient.updateBanner(String(req.params.id), req.body), res, 'Update banner');
  }

  static async deleteBanner(req: Request, res: Response) {
    return forward(() => bannerClient.deleteBanner(String(req.params.id)), res, 'Delete banner');
  }

  static async reorderBanners(req: Request, res: Response) {
    return forward(() => bannerClient.reorderBanners(req.body?.orderedIds || []), res, 'Reorder banners');
  }

  static async uploadBannerImage(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No image file uploaded' });
      }
      const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const key = `home-banners/${Date.now()}-${randomUUID()}.${ext}`;
      const url = await minioService.uploadPublicFile(key, req.file.buffer, req.file.mimetype);
      return res.json({ success: true, data: { url, key } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Failed to upload banner image' });
    }
  }
}
