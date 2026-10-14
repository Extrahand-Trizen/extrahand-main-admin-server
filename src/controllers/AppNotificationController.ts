import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import logger from '../config/logger';
import { createAuditLog } from '../middleware/audit';
import { minioService } from '../services/MinioService';
import {
  BROADCAST_APPS,
  BroadcastApp,
  notificationServiceClient,
} from '../services/NotificationServiceClient';
import { getClientSafeStatus } from '../utils/upstreamHttp';

const MAX_TITLE_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_LIMIT = 100;
const MAX_SELECTED_USERS = 500;

type BroadcastStatus = 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';

function isBroadcastApp(value: unknown): value is BroadcastApp {
  return typeof value === 'string' && (BROADCAST_APPS as string[]).includes(value);
}

function toBroadcastStatus(campaign: any): BroadcastStatus {
  switch (campaign.status) {
    case 'COMPLETED':
    case 'PARTIAL':
      return 'sent';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'SENDING':
      return 'sending';
    default: {
      const scheduledAt = campaign.scheduledAt ? new Date(campaign.scheduledAt).getTime() : 0;
      return scheduledAt > Date.now() ? 'scheduled' : 'sending';
    }
  }
}

function toBroadcastDto(campaign: any) {
  const userIds = Array.isArray(campaign.userIds)
    ? campaign.userIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  const isSelected = userIds.length > 0;
  return {
    id: String(campaign._id),
    app: campaign.app,
    recipientType: isSelected ? 'selected' : 'all',
    userIds,
    title: campaign.title,
    message: campaign.body,
    imageUrl: campaign.imageUrl || null,
    recipientCount: isSelected ? userIds.length : campaign.audienceSize ?? 0,
    deliveredCount: campaign.sentCount ?? 0,
    failedCount: campaign.failedCount ?? 0,
    status: toBroadcastStatus(campaign),
    failureReason: campaign.failureReason || null,
    scheduledAt: campaign.scheduledAt || null,
    sendAt: campaign.scheduledAt || campaign.createdAt,
    createdBy: campaign.createdBy,
    createdAt: campaign.createdAt,
  };
}

function upstreamError(error: any, fallback: string): string {
  return error?.response?.data?.error || error?.message || fallback;
}

export class AppNotificationController {
  /**
   * GET /api/v1/notifications/broadcasts?app=&limit=&skip=
   */
  static async listBroadcasts(req: Request, res: Response): Promise<void> {
    try {
      const app = req.query.app;
      if (app !== undefined && app !== 'all' && !isBroadcastApp(app)) {
        res.status(400).json({ success: false, error: 'Invalid app' });
        return;
      }

      const limit = Math.min(MAX_HISTORY_LIMIT, Math.max(1, Number(req.query.limit) || 20));
      const skip = Math.max(0, Number(req.query.skip) || 0);

      const result = await notificationServiceClient.listBroadcasts({
        app: isBroadcastApp(app) ? app : 'any',
        limit,
        skip,
      });

      const campaigns: any[] = result?.data?.campaigns || [];
      res.json({
        success: true,
        data: campaigns.map(toBroadcastDto),
        pagination: { total: result?.data?.total ?? campaigns.length, limit, skip },
      });
    } catch (error: any) {
      logger.error('List notification broadcasts error:', error?.message);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: upstreamError(error, 'Failed to load notification history'),
      });
    }
  }

  /**
   * POST /api/v1/notifications/broadcasts
   * Body: { app, title, message, imageUrl?, scheduledAt?, recipientType?: 'all' | 'selected', userIds? }
   */
  static async sendBroadcast(req: Request, res: Response): Promise<void> {
    try {
      const { app, imageUrl, scheduledAt } = req.body || {};
      const title = String(req.body?.title || '').trim();
      const message = String(req.body?.message || '').trim();
      const recipientType = req.body?.recipientType === 'selected' ? 'selected' : 'all';

      if (!isBroadcastApp(app)) {
        res.status(400).json({ success: false, error: 'Select a valid app' });
        return;
      }

      let userIds: string[] | undefined;
      if (recipientType === 'selected') {
        const raw: unknown[] = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
        userIds = Array.from(new Set(raw.map((id) => String(id || '').trim()).filter(Boolean)));
        if (userIds.length === 0) {
          res.status(400).json({ success: false, error: 'Select at least one user' });
          return;
        }
        if (userIds.length > MAX_SELECTED_USERS) {
          res.status(400).json({ success: false, error: `You can select up to ${MAX_SELECTED_USERS} users` });
          return;
        }
      }
      if (!title || title.length > MAX_TITLE_LENGTH) {
        res.status(400).json({ success: false, error: `Title is required (max ${MAX_TITLE_LENGTH} characters)` });
        return;
      }
      if (!message || message.length > MAX_MESSAGE_LENGTH) {
        res.status(400).json({ success: false, error: `Message is required (max ${MAX_MESSAGE_LENGTH} characters)` });
        return;
      }
      if (imageUrl && !/^https?:\/\//i.test(String(imageUrl))) {
        res.status(400).json({ success: false, error: 'Image URL must start with http:// or https://' });
        return;
      }

      let scheduledIso: string | undefined;
      if (scheduledAt) {
        const date = new Date(scheduledAt);
        if (Number.isNaN(date.getTime())) {
          res.status(400).json({ success: false, error: 'Schedule date & time is invalid' });
          return;
        }
        if (date.getTime() <= Date.now()) {
          res.status(400).json({ success: false, error: 'Schedule date & time must be in the future' });
          return;
        }
        scheduledIso = date.toISOString();
      }

      const result = await notificationServiceClient.createBroadcast({
        app,
        title,
        body: message,
        imageUrl: imageUrl ? String(imageUrl) : undefined,
        scheduledAt: scheduledIso,
        userIds,
        createdBy: req.admin?.email || req.admin?.userId || 'admin',
      });

      const campaign = result?.data;
      await createAuditLog(req, 'notification.broadcast.create', 'notification_campaign', String(campaign?._id || 'unknown'), {
        app,
        recipientType,
        title,
        scheduledAt: scheduledIso || null,
        recipientCount: campaign?.audienceSize ?? null,
      });

      res.status(201).json({
        success: true,
        data: campaign ? toBroadcastDto(campaign) : null,
        message: scheduledIso ? 'Notification scheduled' : 'Notification is being sent',
      });
    } catch (error: any) {
      logger.error('Send notification broadcast error:', error?.message);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: upstreamError(error, 'Failed to send notification'),
      });
    }
  }

  /**
   * POST /api/v1/notifications/broadcasts/:campaignId/cancel
   */
  static async cancelBroadcast(req: Request, res: Response): Promise<void> {
    try {
      const { campaignId } = req.params;
      const result = await notificationServiceClient.cancelBroadcast(campaignId);

      await createAuditLog(req, 'notification.broadcast.cancel', 'notification_campaign', campaignId);

      res.json({
        success: true,
        data: result?.data ? toBroadcastDto(result.data) : null,
        message: 'Scheduled notification cancelled',
      });
    } catch (error: any) {
      logger.error('Cancel notification broadcast error:', error?.message);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: upstreamError(error, 'Failed to cancel notification'),
      });
    }
  }

  /**
   * POST /api/v1/notifications/broadcasts/clear
   * Body: { app } — removes notifications sent from this page for every user of the app.
   */
  static async clearBroadcasts(req: Request, res: Response): Promise<void> {
    try {
      const { app } = req.body || {};
      if (!isBroadcastApp(app)) {
        res.status(400).json({ success: false, error: 'Select a valid app' });
        return;
      }

      const result = await notificationServiceClient.clearBroadcasts(app);
      const deletedCount = result?.data?.deletedCount ?? 0;

      await createAuditLog(req, 'notification.broadcast.clear', 'notification_campaign', app, { app, deletedCount });

      res.json({
        success: true,
        data: { app, deletedCount },
        message: `${deletedCount} notification(s) cleared`,
      });
    } catch (error: any) {
      logger.error('Clear notification broadcasts error:', error?.message);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: upstreamError(error, 'Failed to clear notifications'),
      });
    }
  }

  /**
   * POST /api/v1/notifications/broadcasts/image (multipart, field `image`)
   */
  static async uploadImage(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: 'No image uploaded' });
        return;
      }

      const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const key = `notifications/broadcasts/${Date.now()}-${randomUUID()}.${ext}`;
      const url = await minioService.uploadPublicFile(key, req.file.buffer, req.file.mimetype);

      res.json({ success: true, data: { url } });
    } catch (error: any) {
      logger.error('Upload notification image error:', error?.message);
      res.status(500).json({ success: false, error: error?.message || 'Failed to upload image' });
    }
  }
}
