import { Request, Response } from 'express';
import logger from '../config/logger';
import {
  dispatchWorkWhatsApp,
  getWorkWhatsAppDispatchStatuses,
  getWhatsAppNotificationSettings,
  resendWorkWhatsApp,
  updateWhatsAppNotificationSettings,
} from '../services/WhatsAppDispatchService';

const DISPATCH_STAGES = ['preferred', 'area_rule', 'all'] as const;

export class WhatsAppNotificationController {
  static async getSettings(_req: Request, res: Response): Promise<void> {
    try {
      res.json({
        success: true,
        data: await getWhatsAppNotificationSettings(),
      });
    } catch (error) {
      logger.error('Get WhatsApp notification settings error', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to load WhatsApp notification settings',
      });
    }
  }

  static async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      if (typeof req.body?.enabled !== 'boolean') {
        res.status(400).json({
          success: false,
          error: 'enabled must be a boolean',
        });
        return;
      }
      const data = await updateWhatsAppNotificationSettings(
        req.body.enabled,
        req.admin?.userId,
      );
      res.json({ success: true, data });
    } catch (error) {
      logger.error('Update WhatsApp notification settings error', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to save WhatsApp notification settings',
      });
    }
  }

  static async dispatchWork(req: Request, res: Response): Promise<void> {
    const { taskId, stage, recipientUids, title, category, locationLabel } =
      req.body || {};
    if (
      typeof taskId !== 'string' ||
      !taskId.trim() ||
      taskId.length > 200 ||
      !DISPATCH_STAGES.includes(stage) ||
      !Array.isArray(recipientUids) ||
      recipientUids.length > 500 ||
      recipientUids.some(
        (uid: unknown) =>
          typeof uid !== 'string' || !uid.trim() || uid.length > 200,
      ) ||
      typeof title !== 'string' ||
      typeof category !== 'string' ||
      typeof locationLabel !== 'string'
    ) {
      res.status(400).json({
        success: false,
        error: 'Invalid work-dispatch WhatsApp payload',
      });
      return;
    }

    try {
      const data = await dispatchWorkWhatsApp({
        taskId,
        stage,
        recipientUids: Array.from(new Set(recipientUids.map((uid: string) => uid.trim()))),
        title: title.trim().slice(0, 500) || 'New work',
        category: category.trim().slice(0, 200) || 'work',
        locationLabel: locationLabel.trim().slice(0, 300),
      });
      res.json({ success: true, data });
    } catch (error) {
      logger.error('Work-dispatch WhatsApp processing failed', {
        taskId,
        stage,
        error,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to process work-dispatch WhatsApp notifications',
      });
    }
  }

  static async getDispatchStatuses(req: Request, res: Response): Promise<void> {
    const taskId = String(req.query.taskId || '');
    if (!taskId.trim() || taskId.length > 200) {
      res.status(400).json({ success: false, error: 'Valid taskId is required' });
      return;
    }
    try {
      res.json({
        success: true,
        data: await getWorkWhatsAppDispatchStatuses(taskId),
      });
    } catch (error) {
      logger.error('Get work-dispatch WhatsApp statuses failed', { taskId, error });
      res.status(500).json({ success: false, error: 'Failed to load WhatsApp statuses' });
    }
  }

  static async resendWork(req: Request, res: Response): Promise<void> {
    const { taskId, stage, partnerUid, title, category, locationLabel } = req.body || {};
    const invalidField =
      typeof taskId !== 'string' || !taskId.trim() || taskId.length > 200
        ? 'taskId'
        : !DISPATCH_STAGES.includes(stage)
          ? 'stage'
          : typeof partnerUid !== 'string' || !partnerUid.trim()
            ? 'partnerUid'
            : typeof title !== 'string'
              ? 'title'
              : typeof category !== 'string'
                ? 'category'
                : typeof locationLabel !== 'string'
                  ? 'locationLabel'
                  : undefined;
    if (invalidField) {
      logger.warn('Invalid WhatsApp resend payload', {
        invalidField,
        taskId: typeof taskId === 'string' ? taskId : typeof taskId,
        stage: typeof stage === 'string' ? stage : typeof stage,
        partnerUid: typeof partnerUid === 'string' ? 'present' : typeof partnerUid,
      });
      res.status(400).json({
        success: false,
        error: `Invalid WhatsApp resend payload: ${invalidField}`,
      });
      return;
    }
    try {
      const data = await resendWorkWhatsApp(
        {
          taskId,
          stage,
          recipientUids: [partnerUid.trim()],
          title: title.trim().slice(0, 500) || 'New work',
          category: category.trim().slice(0, 200) || 'work',
          locationLabel: locationLabel.trim().slice(0, 300),
        },
        partnerUid.trim(),
      );
      res.json({ success: true, data });
    } catch (error) {
      logger.error('Work-dispatch WhatsApp resend failed', { taskId, partnerUid, stage, error });
      res.status(500).json({ success: false, error: 'Failed to resend WhatsApp notification' });
    }
  }
}
