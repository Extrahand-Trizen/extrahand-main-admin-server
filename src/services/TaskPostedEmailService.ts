import axios from 'axios';
import mongoose from 'mongoose';
import logger from '../config/logger';
import { env } from '../config/env';
import { getTaskPostedEmailSettings, isPhoneExcluded } from './TaskPostedEmailSettingsService';
import { getTaskPostedEmailAttempt, recordTaskPostedEmailAttempt } from './TaskPostedEmailAttemptService';
import { selectRetryRecipients, sendToRecipientsIndividually } from './TaskPostedEmailRecipients';

type TaskPostedEmailPayload = {
  taskId?: string;
  taskTitle?: string;
  userId?: string;
  userName?: string;
  userPhone?: string;
};

export type TaskPostedEmailResult = {
  status: 'sent' | 'partial' | 'failed' | 'skipped';
  sentRecipients: string[];
  failedRecipients: string[];
  error?: string;
  reason?: string;
};

async function resolveCustomerPhone(payload: TaskPostedEmailPayload): Promise<string | undefined> {
  try {
    if (payload.userPhone) return payload.userPhone;

    const identifiers: Record<string, unknown>[] = [];
    if (payload.userId) identifiers.push({ uid: payload.userId });
    if (payload.userId && mongoose.Types.ObjectId.isValid(payload.userId)) {
      identifiers.push({ _id: new mongoose.Types.ObjectId(payload.userId) });
    }
    if (identifiers.length === 0 || mongoose.connection.readyState !== 1) return undefined;

    const profile = await mongoose.connection.collection('profiles').findOne(
      { $or: identifiers },
      { projection: { phone: 1, mobile: 1, mobileNumber: 1, phoneNumber: 1, alternatePhone: 1 } },
    );
    return profile?.phone || profile?.mobile || profile?.mobileNumber || profile?.phoneNumber || profile?.alternatePhone;
  } catch (error: any) {
    logger.warn('[TaskPostedEmail][main-admin-server] Customer phone lookup failed', {
      taskId: payload.taskId,
      userId: payload.userId,
      error: error?.message || String(error),
    });
    return payload.userPhone;
  }
}

export async function sendTaskPostedEmail(
  payload: TaskPostedEmailPayload,
  options: { retryFailedOnly?: boolean } = {},
): Promise<TaskPostedEmailResult> {
  if (!env.EMAIL_SERVICE_URL) {
    logger.warn('[TaskPostedEmail][main-admin-server] Email service URL is not configured');
    await recordTaskPostedEmailAttempt({ taskId: payload.taskId, status: 'failed', error: 'Email service URL is not configured' });
    return { status: 'failed', sentRecipients: [], failedRecipients: [], error: 'Email service URL is not configured' };
  }

  const settings = await getTaskPostedEmailSettings();
  const customerPhone = await resolveCustomerPhone(payload);
  if (isPhoneExcluded(customerPhone, settings.excludedPhones)) {
    logger.info('[TaskPostedEmail][main-admin-server] Email skipped for excluded customer phone', {
      taskId: payload.taskId,
      taskTitle: payload.taskTitle,
      customerPhone: customerPhone ? `***${customerPhone.slice(-4)}` : undefined,
    });
    await recordTaskPostedEmailAttempt({ taskId: payload.taskId, status: 'skipped', error: 'Customer phone is excluded' });
    return { status: 'skipped', sentRecipients: [], failedRecipients: [], error: 'Customer phone is excluded' };
  }

  const configuredRecipients = settings.recipients;
  if (configuredRecipients.length === 0) {
    logger.warn('[TaskPostedEmail][main-admin-server] No work-posted email recipients configured', {
      taskId: payload.taskId,
      taskTitle: payload.taskTitle,
    });
    await recordTaskPostedEmailAttempt({ taskId: payload.taskId, status: 'failed', error: 'No recipients configured' });
    return { status: 'failed', sentRecipients: [], failedRecipients: [], error: 'No recipients configured' };
  }
  const previousAttempt = options.retryFailedOnly
    ? await getTaskPostedEmailAttempt(payload.taskId)
    : null;
  const recipients = options.retryFailedOnly
    ? selectRetryRecipients(previousAttempt, configuredRecipients)
    : configuredRecipients;
  if (recipients.length === 0) {
    return {
      status: 'skipped',
      sentRecipients: previousAttempt?.sentRecipients || [],
      failedRecipients: [],
      error: 'There are no failed recipients to retry',
      reason: 'no_failed_recipients',
    };
  }
  const taskTitle = payload.taskTitle?.trim() || 'Untitled task';
  const customerName = payload.userName?.trim() || 'A customer';
  const taskLink = payload.taskId
    ? `${env.OPERATIONS_PORTAL_URL}/tasks/${encodeURIComponent(payload.taskId)}`
    : env.OPERATIONS_PORTAL_URL;

  try {
    const outcomes = await sendToRecipientsIndividually(recipients, async (recipient) => {
      const response = await axios.post(
        `${env.EMAIL_SERVICE_URL}/api/v1/email/send`,
        {
          to: recipient,
          template: 'admin_alert',
          data: {
            title: 'New work posted',
            message: `${customerName} has posted new work: ${taskTitle}.`,
            linkUrl: taskLink,
          },
          metadata: {
            taskId: payload.taskId,
            taskTitle,
          },
        },
        {
          headers: {
            'X-Service-Auth': env.EMAIL_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN,
            'X-Service-Name': 'main-admin-server',
          },
        },
      );
      if (response.data?.success === false) {
        throw new Error(response.data.error || 'Email service rejected the request');
      }
    });
    const sentRecipients = Array.from(new Set([
      ...(previousAttempt?.sentRecipients || []),
      ...outcomes.sentRecipients,
    ]));
    const failedRecipients = outcomes.failures.map((failure) => failure.recipient);
    const status: TaskPostedEmailResult['status'] = failedRecipients.length === 0
      ? 'sent'
      : sentRecipients.length > 0
        ? 'partial'
        : 'failed';
    const error = outcomes.failures.length > 0
      ? outcomes.failures.map(({ recipient, error: failure }) => `${recipient}: ${failure}`).join('; ')
      : undefined;

    if (failedRecipients.length > 0) {
      logger.warn('[TaskPostedEmail][main-admin-server] Some work-posted emails failed', {
        taskId: payload.taskId,
        taskTitle,
        sentRecipients,
        failedRecipients,
        error,
      });
    }

    logger.info('[TaskPostedEmail][main-admin-server] Work-posted email attempts completed', {
      taskId: payload.taskId,
      taskTitle,
      customerName,
      status,
      sentRecipients,
      failedRecipients,
    });
    await recordTaskPostedEmailAttempt({
      taskId: payload.taskId,
      status,
      recipients: previousAttempt?.recipients?.length ? previousAttempt.recipients : configuredRecipients,
      sentRecipients,
      failedRecipients,
      error,
    });
    return { status, sentRecipients, failedRecipients, error };
  } catch (error: any) {
    logger.error('[TaskPostedEmail][main-admin-server] Failed to send work-posted email', {
      taskId: payload.taskId,
      taskTitle,
      error: error?.message || error,
    });
    await recordTaskPostedEmailAttempt({
      taskId: payload.taskId,
      status: 'failed',
      recipients: previousAttempt?.recipients?.length ? previousAttempt.recipients : configuredRecipients,
      sentRecipients: previousAttempt?.sentRecipients || [],
      failedRecipients: recipients,
      error: error?.message || String(error),
    });
    return {
      status: 'failed',
      sentRecipients: previousAttempt?.sentRecipients || [],
      failedRecipients: recipients,
      error: error?.message || String(error),
    };
  }
}