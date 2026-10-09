import { Request, Response } from 'express';
import logger from '../config/logger';
import {
  getRoundRobinTeamDetails,
  updateRoundRobinEmails,
} from '../services/RoundRobinTeamSettingsService';

export class RoundRobinTeamSettingsController {
  static async get(req: Request, res: Response): Promise<void> {
    try {
      const data = await getRoundRobinTeamDetails();
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Get round-robin team settings error', { error });
      res.status(500).json({ success: false, error: 'Failed to load round-robin team settings' });
    }
  }

  static async update(req: Request, res: Response): Promise<void> {
    try {
      const emails = Array.isArray(req.body?.emails) ? req.body.emails : [];
      if (emails.length === 0) {
        res.status(400).json({
          success: false,
          error: 'At least one operations admin must be included in the round-robin order',
        });
        return;
      }

      if (emails.some((email: unknown) => typeof email !== 'string' || !email.includes('@'))) {
        res.status(400).json({
          success: false,
          error: 'All members must have a valid email address',
        });
        return;
      }

      await updateRoundRobinEmails(emails, req.admin?.userId);
      const data = await getRoundRobinTeamDetails();
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Update round-robin team settings error', { error });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to save round-robin team settings',
      });
    }
  }
}
