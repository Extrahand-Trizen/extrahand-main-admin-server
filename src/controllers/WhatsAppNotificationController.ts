import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { AxiosError } from 'axios';
import logger from '../config/logger';
import {
  dispatchWorkWhatsApp,
  getWorkWhatsAppDispatchStatuses,
  getWhatsAppNotificationSettings,
  resendWorkWhatsApp,
  updateWhatsAppNotificationSettings,
} from '../services/WhatsAppDispatchService';
import {
  countWhatsAppAudience,
  createWhatsAppCampaign,
  listApprovedWhatsAppTemplates,
  listWhatsAppCampaignHistory,
  listWhatsAppCampaignRecipients,
  WhatsAppCampaignInputError,
} from '../services/WhatsAppCampaignService';
import { userServiceClient } from '../services/UserServiceClient';
import type { WhatsAppCampaignApp } from '../models/WhatsAppNotificationCampaign';

const WHATSAPP_APPS: WhatsAppCampaignApp[] = [
  'customer_app',
  'helper_app',
  'seller_app',
];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parsePage(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
}

const DISPATCH_STAGES = ['preferred', 'area_rule', 'all'] as const;

export class WhatsAppNotificationController {
  static async getPartnerCategories(_req: Request, res: Response): Promise<void> {
    try {
      const response = await userServiceClient.listWhatsAppCategories();
      if (!response?.success || !Array.isArray(response.data)) {
        throw new Error('User service returned an invalid partner category catalog');
      }

      const data = response.data
        .filter((category: { id?: unknown; name?: unknown }) =>
          typeof category.id === 'string' && typeof category.name === 'string',
        )
        .map((category: { id: string; name: string }) => ({
          id: category.id,
          name: category.name.trim(),
        }))
        .filter((category: { name: string }) => category.name.length > 0);

      res.json({ success: true, data });
    } catch (error) {
      logger.error('Get WhatsApp partner categories failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(502).json({
        success: false,
        error: 'Failed to load partner categories from the user service',
      });
    }
  }

  static async getApprovedTemplates(_req: Request, res: Response): Promise<void> {
    try {
      res.json({ success: true, data: await listApprovedWhatsAppTemplates() });
    } catch (error) {
      const axiosError = error as AxiosError;
      const dialogStatus = axiosError.response?.status;
      logger.error('Get approved WhatsApp templates failed', {
        dialogStatus,
        message: axiosError.message,
      });
      res.status(502).json({
        success: false,
        error:
          dialogStatus === 403
            ? 'Dialog denied template access. The API key must have templates:read or messages:write scope.'
            : dialogStatus === 401
              ? 'Dialog rejected its API key. Check the configured Dialog API key.'
              : 'Failed to load approved WhatsApp templates from Dialog. Check the Dialog service connection and configuration.',
      });
    }
  }

  static async getAudienceCount(req: Request, res: Response): Promise<void> {
    const { app, categories = [], cities = [], workAreas = [] } = req.body || {};
    if (
      !WHATSAPP_APPS.includes(app) ||
      !isStringArray(categories) ||
      !isStringArray(cities) ||
      !isStringArray(workAreas)
    ) {
      res.status(400).json({ success: false, error: 'Invalid WhatsApp audience filters' });
      return;
    }
    try {
      const count = await countWhatsAppAudience({ app, categories, cities, workAreas });
      res.json({ success: true, data: { count } });
    } catch (error) {
      const status = error instanceof WhatsAppCampaignInputError ? 400 : 502;
      logger.error('Count WhatsApp audience failed', { error, app });
      res.status(status).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to count WhatsApp recipients',
      });
    }
  }

  static async sendCampaign(req: Request, res: Response): Promise<void> {
    const { app, categories = [], cities = [], workAreas = [], templateId, variables } = req.body || {};
    if (
      !WHATSAPP_APPS.includes(app) ||
      !isStringArray(categories) ||
      !isStringArray(cities) ||
      !isStringArray(workAreas) ||
      typeof templateId !== 'string' ||
      !variables ||
      typeof variables !== 'object' ||
      Array.isArray(variables) ||
      Object.values(variables).some((value) => typeof value !== 'string')
    ) {
      res.status(400).json({ success: false, error: 'Invalid WhatsApp campaign payload' });
      return;
    }

    try {
      const campaign = await createWhatsAppCampaign({
        app,
        categories,
        cities,
        workAreas,
        templateId,
        variables,
        createdBy: req.admin?.userId || 'admin',
      });
      logger.info('Admin WhatsApp campaign accepted', {
        campaignId: campaign.id,
        app,
        recipientCount: campaign.recipientCount,
        templateId,
      });
      res.status(202).json({ success: true, data: campaign });
    } catch (error) {
      const status =
        error instanceof WhatsAppCampaignInputError
          ? 400
          : 502;
      logger.error('Create admin WhatsApp campaign failed', { app, templateId, error });
      res.status(status).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start WhatsApp campaign',
      });
    }
  }

  static async getCampaignHistory(req: Request, res: Response): Promise<void> {
    const page = parsePage(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = parsePage(req.query.limit, 20, 100);
    if (page === null || limit === null) {
      res.status(400).json({ success: false, error: 'Invalid WhatsApp history pagination' });
      return;
    }
    try {
      res.json({
        success: true,
        ...(await listWhatsAppCampaignHistory({ page, limit })),
      });
    } catch (error) {
      logger.error('List WhatsApp campaign history failed', { error });
      res.status(500).json({ success: false, error: 'Failed to load WhatsApp campaign history' });
    }
  }

  static async getCampaignRecipients(req: Request, res: Response): Promise<void> {
    if (!mongoose.isValidObjectId(req.params.campaignId)) {
      res.status(400).json({ success: false, error: 'Invalid WhatsApp campaign ID' });
      return;
    }
    const page = parsePage(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = parsePage(req.query.limit, 50, 100);
    if (page === null || limit === null) {
      res.status(400).json({ success: false, error: 'Invalid WhatsApp recipient pagination' });
      return;
    }
    try {
      res.json({
        success: true,
        ...(await listWhatsAppCampaignRecipients({
          campaignId: req.params.campaignId,
          page,
          limit,
        })),
      });
    } catch (error) {
      const status = error instanceof WhatsAppCampaignInputError ? 404 : 500;
      logger.error('List WhatsApp campaign recipients failed', {
        campaignId: req.params.campaignId,
        error,
      });
      res.status(status).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load WhatsApp campaign recipients',
      });
    }
  }

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
      logger.info('Work-dispatch WhatsApp request processed', {
        taskId,
        stage,
        recipientCount: recipientUids.length,
        result: data,
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
