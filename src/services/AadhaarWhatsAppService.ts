import { AxiosError } from 'axios';
import { AadhaarWhatsAppNotification } from '../models/AadhaarWhatsAppNotification';
import { listApprovedWhatsAppTemplates, templateVariableIndexes } from './WhatsAppCampaignService';
import { normalizeWhatsAppRecipientPhone, sendDialogTemplateMessage } from './WhatsAppDispatchService';
import { Profile } from '../models/Profile';
import { AadhaarKycAssignment } from '../models/AadhaarKycAssignment';

export type AadhaarWhatsAppTemplateDto = {
  id: string;
  name: string;
  category: string;
  language: string;
  variables: { index: number; name?: string }[];
};

export type AadhaarWhatsAppSendInput = {
  userId: string;
  operator: { userId: string; email: string; name: string };
  templateId: string;
  variables: Record<string, string>;
  idempotencyKey: string;
  isElevated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getTemplateVariables(template: Awaited<ReturnType<typeof listApprovedWhatsAppTemplates>>[number]) {
  const schema = template.currentVersionDetail?.variableSchema;
  if (!isRecord(schema) || !Array.isArray(schema.variables)) return [];
  return schema.variables
    .filter(
      (variable): variable is { index: number; name?: string } =>
        isRecord(variable) &&
        Number.isSafeInteger(variable.index) &&
        Number(variable.index) > 0 &&
        (variable.name === undefined || typeof variable.name === 'string'),
    )
    .map((variable) => ({
      index: variable.index,
      ...(variable.name ? { name: variable.name } : {}),
    }));
}

export async function listAadhaarWhatsAppTemplates(): Promise<AadhaarWhatsAppTemplateDto[]> {
  const templates = await listApprovedWhatsAppTemplates();
  return templates.map((template) => {
    const namesByIndex = new Map(
      getTemplateVariables(template).map((variable) => [variable.index, variable.name]),
    );
    return {
      id: template.id,
      name: template.metaTemplateName,
      category: template.category,
      language: template.language,
      variables: templateVariableIndexes(template).map((index) => ({
        index,
        ...(namesByIndex.get(index) ? { name: namesByIndex.get(index) } : {}),
      })),
    };
  });
}

export async function listAadhaarWhatsAppNotifications(userId: string) {
  const notifications = await AadhaarWhatsAppNotification.find({ userId })
    .sort({ sentAt: -1 })
    .limit(50)
    .lean();

  return notifications.map((notification) => ({
    id: String(notification._id),
    userId: notification.userId,
    phoneNumber: notification.phoneNumber,
    templateId: notification.templateId,
    templateName: notification.templateName,
    templateLanguage: notification.templateLanguage,
    variables: notification.variables,
    sentBy: notification.sentBy,
    sentAt: notification.sentAt.toISOString(),
    dialogMessageId: notification.dialogMessageId ?? null,
    sendStatus: notification.sendStatus,
    deliveryStatus: notification.deliveryStatus ?? null,
    failureReason: notification.failureReason ?? null,
  }));
}

export async function sendAadhaarWhatsAppNotification(input: AadhaarWhatsAppSendInput): Promise<{
  notification: Record<string, unknown>;
  duplicate: boolean;
}> {
  const profile = await Profile.findOne({
    uid: input.userId,
    roles: { $in: ['tasker', 'both', 'helper', 'partner'] },
    isAadhaarVerified: false,
  })
    .select('uid name phone mobile phoneNumber isAadhaarVerified')
    .lean();
  if (!profile || profile.isAadhaarVerified === true) {
    throw new AadhaarWhatsAppInputError('This user is no longer eligible for an Aadhaar follow-up');
  }

  if (!input.isElevated) {
    const assignment = await AadhaarKycAssignment.findOne({ userId: input.userId })
      .select('assignedToUserId')
      .lean();
    if (assignment?.assignedToUserId !== input.operator.userId) {
      throw new AadhaarWhatsAppAccessError();
    }
  }

  const phoneNumber = normalizeWhatsAppRecipientPhone({
    phone: profile.phone,
    mobile: profile.mobile,
    phoneNumber: profile.phoneNumber,
  });
  if (!phoneNumber) {
    throw new AadhaarWhatsAppInputError('The user does not have a valid registered phone number');
  }

  const templates = await listApprovedWhatsAppTemplates();
  const template = templates.find((candidate) => candidate.id === input.templateId);
  if (!template) {
    throw new AadhaarWhatsAppInputError('The selected WhatsApp template is not approved or is unavailable');
  }

  const variableIndexes = templateVariableIndexes(template);
  const expectedKeys = new Set(variableIndexes.map(String));
  const suppliedKeys = Object.keys(input.variables);
  if (
    suppliedKeys.some((key) => !expectedKeys.has(key)) ||
    variableIndexes.some((index) => {
      const value = input.variables[String(index)];
      return typeof value !== 'string' || !value.trim() || value.length > 1024;
    })
  ) {
    throw new AadhaarWhatsAppInputError(
      'Enter a value for every template variable and remove any unexpected values',
    );
  }

  const sentAt = new Date();
  let notification;
  try {
    notification = await AadhaarWhatsAppNotification.create({
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      userName: profile.name || 'Unknown',
      phoneNumber,
      templateId: template.id,
      templateName: template.metaTemplateName,
      templateLanguage: template.language,
      variables: Object.fromEntries(
        variableIndexes.map((index) => [String(index), input.variables[String(index)].trim()]),
      ),
      sentBy: input.operator,
      sentAt,
      sendStatus: 'sending',
    });
  } catch (error) {
    if ((error as { code?: number })?.code !== 11000) throw error;

    const existing = await AadhaarWhatsAppNotification.findOne({
      idempotencyKey: input.idempotencyKey,
    }).lean();
    if (!existing || existing.userId !== input.userId || existing.sentBy.userId !== input.operator.userId) {
      throw new AadhaarWhatsAppInputError('This send request key has already been used');
    }
    return { notification: serializeNotification(existing), duplicate: true };
  }

  let dialogMessageId: string | undefined;
  try {
    dialogMessageId = await sendDialogTemplateMessage({
      template: template.metaTemplateName,
      language: template.language,
      to: phoneNumber,
      variables: Object.fromEntries(
        variableIndexes.map((index) => [String(index), input.variables[String(index)].trim()]),
      ),
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    const axiosError = error as AxiosError;
    const failureReason = `Dilog messaging request failed${axiosError.response?.status ? ` (HTTP ${axiosError.response.status})` : ''}`;
    await AadhaarWhatsAppNotification.updateOne(
      { _id: notification._id, sendStatus: 'sending' },
      { $set: { sendStatus: 'failed', failureReason } },
    );
    throw new AadhaarWhatsAppSendError(failureReason);
  }

  await AadhaarWhatsAppNotification.updateOne(
    { _id: notification._id, sendStatus: 'sending' },
    {
      $set: {
        sendStatus: 'accepted',
        ...(dialogMessageId ? { dialogMessageId } : {}),
      },
      $unset: { failureReason: 1 },
    },
  );
  const accepted = await AadhaarWhatsAppNotification.findById(notification._id).lean();
  if (!accepted) throw new Error('Notification record disappeared after Dilog accepted the request');
  return { notification: serializeNotification(accepted), duplicate: false };
}

const DELIVERY_STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 100,
};

export async function applyAadhaarWhatsAppDeliveryUpdate(input: {
  idempotencyKey: string;
  dialogMessageId: string;
  event: 'message.accepted' | 'message.sent' | 'message.delivered' | 'message.read' | 'message.failed';
  failureReason?: string;
}): Promise<'updated' | 'duplicate' | 'not-found' | 'message-mismatch'> {
  const notification = await AadhaarWhatsAppNotification.findOne({
    idempotencyKey: input.idempotencyKey,
  });
  if (!notification) return 'not-found';
  if (notification.dialogMessageId && notification.dialogMessageId !== input.dialogMessageId) {
    return 'message-mismatch';
  }

  const nextStatus =
    input.event === 'message.sent'
      ? 'sent'
      : input.event === 'message.delivered'
        ? 'delivered'
        : input.event === 'message.read'
          ? 'read'
          : input.event === 'message.failed'
            ? 'failed'
            : undefined;
  const currentStatus = notification.deliveryStatus;
  const canAdvance = nextStatus
    ? !currentStatus ||
      (currentStatus !== 'failed' &&
        (nextStatus === 'failed' ||
          DELIVERY_STATUS_RANK[nextStatus] >= DELIVERY_STATUS_RANK[currentStatus]))
    : true;

  if (!canAdvance) return 'duplicate';

  const update = await AadhaarWhatsAppNotification.updateOne(
    {
      _id: notification._id,
      $and: [
        currentStatus
          ? { deliveryStatus: currentStatus }
          : { $or: [{ deliveryStatus: { $exists: false } }, { deliveryStatus: null }] },
        {
          $or: [
            { dialogMessageId: { $exists: false } },
            { dialogMessageId: null },
            { dialogMessageId: input.dialogMessageId },
          ],
        },
      ],
    },
    {
      $set: {
        dialogMessageId: input.dialogMessageId,
        sendStatus: 'accepted',
        ...(nextStatus
          ? {
              deliveryStatus: nextStatus,
              deliveryUpdatedAt: new Date(),
            }
          : {}),
        ...(input.failureReason ? { failureReason: input.failureReason.slice(0, 1000) } : {}),
      },
    },
  );

  if (update.modifiedCount === 0) return 'duplicate';
  return 'updated';
}

function serializeNotification(notification: {
  _id: unknown;
  userId: string;
  userName: string;
  phoneNumber: string;
  templateId: string;
  templateName: string;
  templateLanguage: string;
  variables: Record<string, string>;
  sentBy: { userId: string; email: string; name: string };
  sentAt: Date;
  dialogMessageId?: string;
  sendStatus: string;
  deliveryStatus?: string;
  failureReason?: string;
}) {
  return {
    id: String(notification._id),
    userId: notification.userId,
    userName: notification.userName,
    phoneNumber: notification.phoneNumber,
    templateId: notification.templateId,
    templateName: notification.templateName,
    templateLanguage: notification.templateLanguage,
    variables: notification.variables,
    sentBy: notification.sentBy,
    sentAt: notification.sentAt.toISOString(),
    dialogMessageId: notification.dialogMessageId ?? null,
    sendStatus: notification.sendStatus,
    deliveryStatus: notification.deliveryStatus ?? null,
    failureReason: notification.failureReason ?? null,
  };
}

export class AadhaarWhatsAppInputError extends Error {}
export class AadhaarWhatsAppAccessError extends Error {}
export class AadhaarWhatsAppSendError extends Error {}
