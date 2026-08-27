import { Request, Response } from 'express';
import logger from '../config/logger';
import {
  getTaskPostedEmailSettings,
  updateTaskPostedEmailSettings,
} from '../services/TaskPostedEmailSettingsService';

export class TaskPostedEmailSettingsController {
  static async get(req: Request, res: Response): Promise<void> {
    try {
      res.json({ success: true, data: await getTaskPostedEmailSettings() });
    } catch (error) {
      logger.error('Get task-posted email settings error', { error });
      res.status(500).json({ success: false, error: 'Failed to load task-posted email settings' });
    }
  }

  static async update(req: Request, res: Response): Promise<void> {
    try {
      const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
      const excludedPhones = Array.isArray(req.body?.excludedPhones) ? req.body.excludedPhones : [];
      if (recipients.some((email: unknown) => typeof email !== 'string' || !email.includes('@'))) {
        res.status(400).json({ success: false, error: 'All recipients must be valid email addresses' });
        return;
      }
      const data = await updateTaskPostedEmailSettings(
        { recipients, excludedPhones },
        req.admin?.userId,
      );
      res.json({ success: true, data });
    } catch (error) {
      logger.error('Update task-posted email settings error', { error });
      res.status(500).json({ success: false, error: 'Failed to save task-posted email settings' });
    }
  }
}