import axios from 'axios';
import mongoose from 'mongoose';
import logger from '../config/logger';
import { env } from '../config/env';
import { getTaskPostedEmailSettings, isPhoneExcluded } from './TaskPostedEmailSettingsService';
import { recordTaskPostedEmailAttempt } from './TaskPostedEmailAttemptService';

type TaskPostedEmailPayload = {
  taskId?: string;
  taskTitle?: string;
  userId?: string;
  userName?: string;
  userPhone?: string;
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

export async function sendTaskPostedEmail(payload: TaskPostedEmailPayload): Promise<boolean> {
  if (!env.EMAIL_SERVICE_URL) {
    logger.warn('[TaskPostedEmail][main-admin-server] Email service URL is not configured');
    await recordTaskPostedEmailAttempt({ taskId: payload.taskId, status: 'failed', error: 'Email service URL is not configured' });
    return false;
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
    return false;
  }

  const recipients = settings.recipients;
  if (recipients.length === 0) {
    logger.warn('[TaskPostedEmail][main-admin-server] No work-posted email recipients configured', {
      taskId: payload.taskId,
      taskTitle: payload.taskTitle,
    });
    await recordTaskPostedEmailAttempt({ taskId: payload.taskId, status: 'failed', error: 'No recipients configured' });
    return false;
  }
  const taskTitle = payload.taskTitle?.trim() || 'Untitled task';
  const customerName = payload.userName?.trim() || 'A customer';
  const taskLink = payload.taskId
    ? `${env.OPERATIONS_PORTAL_URL}/tasks/${encodeURIComponent(payload.taskId)}`
    : env.OPERATIONS_PORTAL_URL;

  try {
    await axios.post(
      `${env.EMAIL_SERVICE_URL}/api/v1/email/send`,
      {
        to: recipients,
        template: 'admin_alert',
        data: {
          title: 'New work posted',
          message: `${customerName} has posted new work: ${taskTitle}.`,
          linkUrl: taskLink,
        },
        metadata: {
          notificationCategory: 'system',
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

    logger.info('[TaskPostedEmail][main-admin-server] Work-posted email sent', {
      taskId: payload.taskId,
      taskTitle,
      customerName,
      recipients,
    });
    await recordTaskPostedEmailAttempt({ taskId: payload.taskId, status: 'sent', recipients });
    return true;
  } catch (error: any) {
    logger.error('[TaskPostedEmail][main-admin-server] Failed to send work-posted email', {
      taskId: payload.taskId,
      taskTitle,
      error: error?.message || error,
    });
    await recordTaskPostedEmailAttempt({
      taskId: payload.taskId,
      status: 'failed',
      recipients,
      error: error?.message || String(error),
    });
    return false;
  }
}