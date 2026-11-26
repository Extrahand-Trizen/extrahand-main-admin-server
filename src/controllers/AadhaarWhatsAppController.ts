import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import logger from '../config/logger';
import { env } from '../config/env';
import {
  AadhaarWhatsAppAccessError,
  AadhaarWhatsAppInputError,
  AadhaarWhatsAppSendError,
  applyAadhaarWhatsAppDeliveryUpdate,
  listAadhaarWhatsAppNotifications,
  listAadhaarWhatsAppTemplates,
  sendAadhaarWhatsAppNotification,
} from '../services/AadhaarWhatsAppService';
import { AadhaarKycAssignment } from '../models/AadhaarKycAssignment';

const OPS_ROLES = ['operations_admin', 'operation_admin', 'operations'];
const WEBHOOK_EVENTS = [
  'message.accepted',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
] as const;

type DilogWebhookEvent = (typeof WEBHOOK_EVENTS)[number];

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string');
}

function isDilogWebhookEvent(value: unknown): value is DilogWebhookEvent {
  return WEBHOOK_EVENTS.some((candidate) => candidate === value);
}

function isElevated(req: Request): boolean {
  return Boolean(req.admin?.isSuperAdmin || req.admin?.role === 'platform_admin');
}

function hasQueueAccess(req: Request): boolean {
  return Boolean(req.admin && (isElevated(req) || OPS_ROLES.includes(req.admin.role)));
}

async function canAccessUser(req: Request, userId: string): Promise<boolean> {
  if (!req.admin || !hasQueueAccess(req)) return false;
  if (isElevated(req)) return true;

  const assignment = await AadhaarKycAssignment.findOne({ userId })
    .select('assignedToUserId')
    .lean();
  return assignment?.assignedToUserId === req.admin.userId;
}

function rawBody(req: Request): Buffer | undefined {
  return (req as Request & { rawBody?: Buffer }).rawBody;
}

function isValidDilogSignature(body: Buffer, signature: string | undefined): boolean {
  if (!env.DIALOG_WEBHOOK_SECRET || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }
  const digest = createHmac('sha256', env.DIALOG_WEBHOOK_SECRET).update(body).digest();
  const supplied = Buffer.from(signature.slice('sha256='.length), 'hex');
  return supplied.length === digest.length && timingSafeEqual(supplied, digest);
}

export class AadhaarWhatsAppController {
  static async templates(req: Request, res: Response): Promise<void> {
    if (!req.admin || !hasQueueAccess(req)) {
      res.status(req.admin ? 403 : 401).json({ success: false, error: 'Access denied' });
      return;
    }

    try {
      res.json({ success: true, data: await listAadhaarWhatsAppTemplates() });
    } catch (error) {
      logger.error('Failed to load approved Aadhaar WhatsApp templates', {
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(502).json({
        success: false,
        error: 'Failed to load approved WhatsApp templates from Dilog',
      });
    }
  }

  static async history(req: Request, res: Response): Promise<void> {
    const userId = String(req.params.userId || '').trim();
    if (!req.admin || !hasQueueAccess(req)) {
      res.status(req.admin ? 403 : 401).json({ success: false, error: 'Access denied' });
      return;
    }
    if (!(await canAccessUser(req, userId))) {
      res.status(403).json({ success: false, error: 'Access denied to this Aadhaar follow-up' });
      return;
    }

    try {
      res.json({ success: true, data: await listAadhaarWhatsAppNotifications(userId) });
    } catch (error) {
      logger.error('Failed to load Aadhaar WhatsApp notification history', {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ success: false, error: 'Failed to load WhatsApp notification history' });
    }
  }

  static async send(req: Request, res: Response): Promise<void> {
    const userId = String(req.params.userId || '').trim();
    if (!req.admin || !hasQueueAccess(req)) {
      res.status(req.admin ? 403 : 401).json({ success: false, error: 'Access denied' });
      return;
    }
    if (!(await canAccessUser(req, userId))) {
      res.status(403).json({ success: false, error: 'Access denied to this Aadhaar follow-up' });
      return;
    }

    const { templateId, variables, idempotencyKey } = req.body || {};
    if (
      typeof templateId !== 'string' ||
      !templateId.trim() ||
      templateId.length > 200 ||
      !isStringRecord(variables) ||
      typeof idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
    ) {
      res.status(400).json({ success: false, error: 'Invalid WhatsApp send request' });
      return;
    }

    try {
      const result = await sendAadhaarWhatsAppNotification({
        userId,
        operator: {
          userId: req.admin.userId,
          email: req.admin.email,
          name: req.admin.name,
        },
        templateId: templateId.trim(),
        variables,
        idempotencyKey,
        isElevated: isElevated(req),
      });
      res.status(result.duplicate ? 200 : 202).json({
        success: true,
        duplicate: result.duplicate,
        data: result.notification,
      });
    } catch (error) {
      if (error instanceof AadhaarWhatsAppAccessError) {
        res.status(403).json({ success: false, error: 'Access denied to this Aadhaar follow-up' });
        return;
      }
      if (error instanceof AadhaarWhatsAppInputError) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      if (error instanceof AadhaarWhatsAppSendError) {
        res.status(502).json({ success: false, error: error.message });
        return;
      }

      logger.error('Failed to send Aadhaar WhatsApp notification', {
        userId,
        operatorId: req.admin.userId,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ success: false, error: 'Failed to send WhatsApp notification' });
    }
  }

  static async deliveryStatus(req: Request, res: Response): Promise<void> {
    const body = rawBody(req);
    const signature = req.headers['x-trizendialog-signature'];
    if (!body || typeof signature !== 'string' || !isValidDilogSignature(body, signature)) {
      res.status(env.DIALOG_WEBHOOK_SECRET ? 401 : 503).json({
        success: false,
        error: env.DIALOG_WEBHOOK_SECRET ? 'Invalid Dilog webhook signature' : 'Dilog webhook is not configured',
      });
      return;
    }

    const payload = req.body;
    const event = payload?.event;
    const data = payload?.data;
    if (
      typeof event !== 'string' ||
      !isDilogWebhookEvent(event) ||
      !data ||
      typeof data.idempotencyKey !== 'string' ||
      typeof data.messageId !== 'string'
    ) {
      res.status(400).json({ success: false, error: 'Invalid Dilog delivery-status payload' });
      return;
    }

    try {
      const result = await applyAadhaarWhatsAppDeliveryUpdate({
        idempotencyKey: data.idempotencyKey,
        dialogMessageId: data.messageId,
        event,
        failureReason: typeof data.errorMessage === 'string' ? data.errorMessage : undefined,
      });

      if (result === 'message-mismatch') {
        logger.warn('Dilog status callback message ID did not match notification record', {
          idempotencyKey: data.idempotencyKey,
          messageId: data.messageId,
        });
      }
      res.json({ success: true, ignored: result === 'not-found' || result === 'message-mismatch' });
    } catch (error) {
      logger.error('Failed to apply Dilog Aadhaar WhatsApp delivery status', {
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ success: false, error: 'Failed to update WhatsApp delivery status' });
    }
  }
}
