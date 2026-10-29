import axios, { AxiosError } from 'axios';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import logger from '../config/logger';
import { WhatsAppDispatchRecord } from '../models/WhatsAppDispatchRecord';
import { WhatsAppNotificationSettings } from '../models/WhatsAppNotificationSettings';

export type WorkDispatchWhatsAppInput = {
  taskId: string;
  stage: 'preferred' | 'area_rule' | 'all';
  recipientUids: string[];
  title: string;
  category: string;
  locationLabel: string;
};

export type WorkDispatchWhatsAppResult = {
  queuedCount: number;
  failedCount: number;
  disabledCount: number;
  suppressedCount: number;
  duplicateCount: number;
};

export type WorkDispatchWhatsAppStatus = {
  partnerUid: string;
  stage: WorkDispatchWhatsAppInput['stage'];
  status: 'sending' | 'queued' | 'failed' | 'disabled' | 'suppressed';
  attemptCount: number;
  lastError?: string;
  updatedAt?: Date;
};

const SETTINGS_KEY = 'automatic_work_dispatch';
const MAX_ATTEMPTS = 3;
const STALE_SEND_MS = 5 * 60 * 1000;
const RETRY_BATCH_SIZE = 50;

export async function getWhatsAppNotificationSettings(): Promise<{
  enabled: boolean;
}> {
  const settings = await WhatsAppNotificationSettings.findOne({
    key: SETTINGS_KEY,
  }).lean();
  return { enabled: settings?.enabled === true };
}

export async function updateWhatsAppNotificationSettings(
  enabled: boolean,
  updatedBy?: string,
): Promise<{ enabled: boolean }> {
  const settings = await WhatsAppNotificationSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { enabled, updatedBy } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  if (!enabled) {
    await WhatsAppDispatchRecord.updateMany(
      { status: 'failed' },
      { $set: { status: 'disabled', lastError: 'Disabled in notification settings' } },
    );
  }

  return { enabled: settings?.enabled === true };
}

function getIdempotencyKey(
  taskId: string,
  partnerUid: string,
  stage: WorkDispatchWhatsAppInput['stage'],
): string {
  return `book_now_offer:${taskId}:${partnerUid}:${stage}`;
}

function getResendIdempotencyKey(
  taskId: string,
  partnerUid: string,
  stage: WorkDispatchWhatsAppInput['stage'],
): string {
  return `${getIdempotencyKey(taskId, partnerUid, stage)}:resend:${randomUUID()}`;
}

async function claimDispatchRecord(
  input: WorkDispatchWhatsAppInput,
  partnerUid: string,
): Promise<{ id: unknown; attemptCount: number } | null> {
  const idempotencyKey = getIdempotencyKey(input.taskId, partnerUid, input.stage);
  try {
    const record = await WhatsAppDispatchRecord.create({
      idempotencyKey,
      taskId: input.taskId,
      partnerUid,
      dispatchStage: input.stage,
      title: input.title,
      category: input.category,
      locationLabel: input.locationLabel,
      status: 'sending',
      attemptCount: 1,
    });
    return { id: record._id, attemptCount: record.attemptCount };
  } catch (error) {
    if ((error as { code?: number })?.code !== 11000) throw error;
  }

  const staleBefore = new Date(Date.now() - STALE_SEND_MS);
  const record = await WhatsAppDispatchRecord.findOneAndUpdate(
    {
      idempotencyKey,
      attemptCount: { $lt: MAX_ATTEMPTS },
      $or: [
        { status: 'failed' },
        { status: 'sending', updatedAt: { $lt: staleBefore } },
      ],
    },
    {
      $set: { status: 'sending' },
      $unset: { lastError: 1 },
      $inc: { attemptCount: 1 },
    },
    { new: true },
  ).select('_id attemptCount').lean();

  return record
    ? { id: record._id, attemptCount: record.attemptCount }
    : null;
}

async function recordDisabledDispatch(
  input: WorkDispatchWhatsAppInput,
  partnerUid: string,
): Promise<'disabled' | 'duplicate'> {
  const idempotencyKey = getIdempotencyKey(input.taskId, partnerUid, input.stage);
  try {
    await WhatsAppDispatchRecord.create({
      idempotencyKey,
      taskId: input.taskId,
      partnerUid,
      dispatchStage: input.stage,
      title: input.title,
      category: input.category,
      locationLabel: input.locationLabel,
      status: 'disabled',
      attemptCount: 0,
      lastError: 'Notifications were disabled for this dispatch event',
    });
    return 'disabled';
  } catch (error) {
    if ((error as { code?: number })?.code !== 11000) throw error;
  }

  await WhatsAppDispatchRecord.updateOne(
    { idempotencyKey, status: 'failed' },
    {
      $set: {
        status: 'disabled',
        lastError: 'Notifications were disabled for this dispatch event',
      },
    },
  );
  return 'duplicate';
}

async function sendToPartner(
  input: WorkDispatchWhatsAppInput,
  partnerUid: string,
): Promise<'queued' | 'failed' | 'disabled' | 'suppressed' | 'duplicate'> {
  const currentSettings = await getWhatsAppNotificationSettings();
  if (!currentSettings.enabled) {
    return recordDisabledDispatch(input, partnerUid);
  }

  const record = await claimDispatchRecord(input, partnerUid);
  if (!record) return 'duplicate';
  return submitClaimedDispatch(input, partnerUid, record.id);
}

async function submitClaimedDispatch(
  input: WorkDispatchWhatsAppInput,
  partnerUid: string,
  recordId: unknown,
  idempotencyKey = getIdempotencyKey(input.taskId, partnerUid, input.stage),
): Promise<'queued' | 'failed' | 'disabled' | 'suppressed'> {
  if (!(await getWhatsAppNotificationSettings()).enabled) {
    await WhatsAppDispatchRecord.updateOne(
      { _id: recordId, status: 'sending' },
      { $set: { status: 'disabled', lastError: 'Notifications were disabled before send' } },
    );
    return 'disabled';
  }

  if (!env.DIALOG_SERVICE_URL || !env.DIALOG_ORGANIZATION_ID || !env.DIALOG_API_KEY) {
    await WhatsAppDispatchRecord.updateOne(
      { _id: recordId },
      { $set: { status: 'failed', lastError: 'Dialog direct messaging configuration is incomplete' } },
    );
    logger.error('WhatsApp dispatch failed because Dialog direct messaging configuration is incomplete', {
      taskId: input.taskId,
      stage: input.stage,
    });
    return 'failed';
  }

  const serviceHeaders = {
    'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
    'X-Service-Name': 'main-admin-server',
  };
  const userServiceUrl = (env.USER_SERVICE_URL || 'http://localhost:4001').replace(/\/+$/, '');
  try {
    const preferenceResponse = await axios.get(
      `${userServiceUrl}/api/v1/notification-preferences/${encodeURIComponent(partnerUid)}/can-send`,
      {
        params: {
          channel: 'whatsapp',
          category: 'recommendedTaskAlerts',
        },
        headers: serviceHeaders,
        timeout: 5000,
      },
    );
    if (preferenceResponse.data?.data?.canSend !== true) {
      await WhatsAppDispatchRecord.updateOne(
        { _id: recordId },
        { $set: { status: 'suppressed', lastError: 'Partner WhatsApp preference is disabled' } },
      );
      return 'suppressed';
    }

    const profileResponse = await axios.get(
      `${userServiceUrl}/api/v1/profiles/internal/${encodeURIComponent(partnerUid)}`,
      { headers: serviceHeaders, timeout: 5000 },
    );
    const profile =
      profileResponse.data?.profile ??
      profileResponse.data?.data?.profile ??
      profileResponse.data?.data;
    const phoneDigits = String(
      profile?.phone ||
        profile?.mobile ||
        profile?.phoneNumber ||
        profile?.alternatePhone ||
        '',
    ).replace(/\D/g, '');
    const recipientPhone =
      phoneDigits.length === 10
        ? `91${phoneDigits}`
        : phoneDigits.length >= 11 && phoneDigits.length <= 15
          ? phoneDigits
          : '';
    if (!recipientPhone) {
      await WhatsAppDispatchRecord.updateOne(
        { _id: recordId },
        { $set: { status: 'suppressed', lastError: 'Partner profile has no valid phone number' } },
      );
      return 'suppressed';
    }

    if (!(await getWhatsAppNotificationSettings()).enabled) {
      await WhatsAppDispatchRecord.updateOne(
        { _id: recordId, status: 'sending' },
        { $set: { status: 'disabled', lastError: 'Notifications were disabled before send' } },
      );
      return 'disabled';
    }

    const response = await axios.post(
      `${env.DIALOG_SERVICE_URL.replace(/\/+$/, '')}/api/v1/messages`,
      {
        template: env.DIALOG_TEMPLATE_NAME,
        language: env.DIALOG_TEMPLATE_LANGUAGE,
        to: recipientPhone,
        variables: {
          '1': input.title,
          '2': input.category,
          '3': input.locationLabel,
          buttonUrlSuffix: input.taskId,
          taskId: input.taskId,
          workId: input.taskId,
          dispatchStage: input.stage,
        },
        idempotencyKey,
        ...(env.DIALOG_PHONE_NUMBER_ID
          ? { phoneNumberId: env.DIALOG_PHONE_NUMBER_ID }
          : {}),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.DIALOG_API_KEY,
        },
        timeout: 12000,
        validateStatus: (status) => status >= 200 && status < 300,
      },
    );

    await WhatsAppDispatchRecord.updateOne(
      { _id: recordId },
      {
        $set: {
          status: 'queued',
          providerEventId:
            typeof response.data?.data?.messageId === 'string'
              ? response.data.data.messageId
              : undefined,
        },
        $unset: { lastError: 1 },
      },
    );
    return 'queued';
  } catch (error) {
    const axiosError = error as AxiosError;
    await WhatsAppDispatchRecord.updateOne(
      { _id: recordId },
      {
        $set: {
          status: 'failed',
          lastError: `Messaging request failed${axiosError.response?.status ? ` (${axiosError.response.status})` : ''}`,
        },
      },
    );
    logger.warn('WhatsApp Dialog work-dispatch request failed', {
      taskId: input.taskId,
      stage: input.stage,
      status: axiosError.response?.status,
      message: axiosError.message,
      responseError:
        typeof axiosError.response?.data === 'object' &&
        axiosError.response.data !== null &&
        'error' in axiosError.response.data
          ? axiosError.response.data.error
          : undefined,
    });
    return 'failed';
  }
}

export async function getWorkWhatsAppDispatchStatuses(
  taskId: string,
): Promise<WorkDispatchWhatsAppStatus[]> {
  const records = await WhatsAppDispatchRecord.find({ taskId })
    .sort({ updatedAt: -1 })
    .lean();
  const latest = new Map<string, WorkDispatchWhatsAppStatus>();
  for (const record of records) {
    const key = `${record.partnerUid}:${record.dispatchStage}`;
    if (!latest.has(key)) {
      latest.set(key, {
        partnerUid: record.partnerUid,
        stage: record.dispatchStage,
        status: record.status,
        attemptCount: record.attemptCount,
        lastError: record.lastError,
        updatedAt: record.updatedAt,
      });
    }
  }
  return Array.from(latest.values());
}

export async function resendWorkWhatsApp(
  input: WorkDispatchWhatsAppInput,
  partnerUid: string,
): Promise<WorkDispatchWhatsAppResult> {
  const result: WorkDispatchWhatsAppResult = {
    queuedCount: 0,
    failedCount: 0,
    disabledCount: 0,
    suppressedCount: 0,
    duplicateCount: 0,
  };
  if (!(await getWhatsAppNotificationSettings()).enabled) {
    result.disabledCount = 1;
    return result;
  }

  const record = await WhatsAppDispatchRecord.create({
    idempotencyKey: getResendIdempotencyKey(input.taskId, partnerUid, input.stage),
    taskId: input.taskId,
    partnerUid,
    dispatchStage: input.stage,
    title: input.title,
    category: input.category,
    locationLabel: input.locationLabel,
    status: 'sending',
    attemptCount: 1,
  });
  const status = await submitClaimedDispatch(
    input,
    partnerUid,
    record._id,
    String(record.idempotencyKey),
  );
  if (status === 'queued') result.queuedCount = 1;
  else if (status === 'failed') result.failedCount = 1;
  else if (status === 'disabled') result.disabledCount = 1;
  else if (status === 'suppressed') result.suppressedCount = 1;
  return result;
}

export async function dispatchWorkWhatsApp(
  input: WorkDispatchWhatsAppInput,
): Promise<WorkDispatchWhatsAppResult> {
  const result: WorkDispatchWhatsAppResult = {
    queuedCount: 0,
    failedCount: 0,
    disabledCount: 0,
    suppressedCount: 0,
    duplicateCount: 0,
  };

  for (const partnerUid of input.recipientUids) {
    const status = await sendToPartner(input, partnerUid);
    if (status === 'queued') result.queuedCount += 1;
    else if (status === 'failed') result.failedCount += 1;
    else if (status === 'disabled') result.disabledCount += 1;
    else if (status === 'suppressed') result.suppressedCount += 1;
    else result.duplicateCount += 1;
  }
  return result;
}

export async function retryFailedWorkWhatsAppDispatches(): Promise<void> {
  if (!(await getWhatsAppNotificationSettings()).enabled) {
    await WhatsAppDispatchRecord.updateMany(
      { status: 'failed' },
      { $set: { status: 'disabled', lastError: 'Notifications are disabled' } },
    );
    return;
  }

  const failed = await WhatsAppDispatchRecord.find({
    status: 'failed',
    attemptCount: { $lt: MAX_ATTEMPTS },
  })
    .sort({ updatedAt: 1 })
    .limit(RETRY_BATCH_SIZE)
    .lean();

  for (const candidate of failed) {
    if (!(await getWhatsAppNotificationSettings()).enabled) {
      await WhatsAppDispatchRecord.updateMany(
        { status: 'failed' },
        { $set: { status: 'disabled', lastError: 'Notifications are disabled' } },
      );
      return;
    }

    const claimed = await WhatsAppDispatchRecord.findOneAndUpdate(
      {
        _id: candidate._id,
        status: 'failed',
        attemptCount: { $lt: MAX_ATTEMPTS },
      },
      {
        $set: { status: 'sending' },
        $unset: { lastError: 1 },
        $inc: { attemptCount: 1 },
      },
      { new: true },
    )
      .select('_id taskId partnerUid dispatchStage title category locationLabel')
      .lean();
    if (!claimed) continue;

    await submitClaimedDispatch(
      {
        taskId: claimed.taskId,
        stage: claimed.dispatchStage,
        recipientUids: [claimed.partnerUid],
        title: claimed.title,
        category: claimed.category,
        locationLabel: claimed.locationLabel || '',
      },
      claimed.partnerUid,
      claimed._id,
    );
  }
}
