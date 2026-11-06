import { AxiosError, Method } from 'axios';
import { Request, Response } from 'express';
import logger from '../config/logger';
import { couponManagementClient } from '../services/CouponManagementClient';
import { getClientSafeStatus } from '../utils/upstreamHttp';

const COUPON_ID = '[A-Za-z0-9_-]+';
const couponRoutes: Array<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/coupons\/home-offers$/ },
  { method: 'GET', path: /^\/coupons$/ },
  { method: 'POST', path: /^\/coupons$/ },
  { method: 'POST', path: /^\/coupons\/bulk$/ },
  { method: 'GET', path: new RegExp(`^/coupons/${COUPON_ID}$`) },
  { method: 'PATCH', path: new RegExp(`^/coupons/${COUPON_ID}$`) },
  { method: 'DELETE', path: new RegExp(`^/coupons/${COUPON_ID}$`) },
  { method: 'PATCH', path: new RegExp(`^/coupons/${COUPON_ID}/status$`) },
];
const catalogRoutes: Array<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/catalog\/hub-sections$/ },
  { method: 'POST', path: /^\/catalog\/hub-sections$/ },
  { method: 'PATCH', path: new RegExp(`^/catalog/hub-sections/${COUPON_ID}$`) },
  { method: 'GET', path: /^\/catalog\/categories\/content$/ },
  { method: 'POST', path: /^\/catalog\/categories\/content$/ },
  { method: 'PATCH', path: new RegExp(`^/catalog/categories/content/${COUPON_ID}$`) },
  { method: 'GET', path: /^\/catalog\/skus\/content$/ },
  { method: 'POST', path: /^\/catalog\/skus\/content$/ },
  { method: 'PATCH', path: new RegExp(`^/catalog/skus/content/${COUPON_ID}$`) },
  { method: 'GET', path: /^\/catalog\/home-promotions$/ },
  { method: 'POST', path: /^\/catalog\/home-promotions$/ },
  { method: 'PATCH', path: new RegExp(`^/catalog/home-promotions/${COUPON_ID}$`) },
  { method: 'GET', path: /^\/catalog\/skus\/operational$/ },
  { method: 'PATCH', path: new RegExp(`^/catalog/skus/operational/${COUPON_ID}/offer$`) },
  { method: 'GET', path: /^\/catalog\/help-support\/(customer|helper)$/ },
  { method: 'PUT', path: /^\/catalog\/help-support\/(customer|helper)\/[^/]+$/ },
  { method: 'PATCH', path: new RegExp(`^/catalog/help-support/${COUPON_ID}$`) },
];

function getUpstreamPath(method: string, path: string): string | null {
  if (catalogRoutes.some((route) => route.method === method && route.path.test(path))) {
    return `/api/v1/catalog/internal${path.slice('/catalog'.length)}`;
  }
  return null;
}

export class CouponManagementController {
  static async proxy(req: Request, res: Response): Promise<void> {
    if (req.path.startsWith('/coupons')) {
      await CouponManagementController.handleCoupons(req, res);
      return;
    }

    const upstreamPath = getUpstreamPath(req.method, req.path);
    if (!upstreamPath) {
      res.status(404).json({ success: false, error: 'Coupon management endpoint was not found' });
      return;
    }

    try {
      const response = await couponManagementClient.request(
        req.method as Method,
        upstreamPath,
        req.query as Record<string, unknown>,
        req.body,
        req.admin?.userId || 'unknown',
      );
      res.status(response.status).json(response.data);
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; message?: string }>;
      const status = axiosError.response ? getClientSafeStatus(error) : 502;
      const responseBody = axiosError.response?.data;
      logger.error('Coupon management upstream request failed', {
        method: req.method,
        path: req.path,
        status,
        message: axiosError.message,
      });
      res.status(status).json(
        responseBody || {
          success: false,
          error: 'Coupon service is unavailable',
        },
      );
    }
  }

  private static async handleCoupons(req: Request, res: Response): Promise<void> {
    const isKnownRoute = couponRoutes.some(
      (route) => route.method === req.method && route.path.test(req.path),
    );
    if (!isKnownRoute) {
      res.status(404).json({ success: false, error: 'Coupon management endpoint was not found' });
      return;
    }

    try {
      const response = await couponManagementClient.requestCoupon(
        req.method as Method,
        req.path === '/coupons/home-offers'
          ? '/api/v1/coupons/home-offers'
          : `/api/v1/coupons/admin${req.path}`,
        req.query as Record<string, unknown>,
        req.body,
        req.admin?.userId || 'unknown',
      );
      res.status(response.status).json(response.data);
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; message?: string }>;
      const status = axiosError.response ? getClientSafeStatus(error) : 502;
      logger.error('Coupon service request failed', {
        method: req.method,
        path: req.path,
        status,
        message: axiosError.message,
      });
      res.status(status).json(
        axiosError.response?.data || {
          success: false,
          error: 'Coupon service is unavailable',
        },
      );
    }
  }
}
