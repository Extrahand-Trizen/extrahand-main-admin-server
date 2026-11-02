import axios, { AxiosError } from 'axios';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { env } from '../config/env';
import logger from '../config/logger';
import {
  WhatsAppCampaignRecipient,
  WhatsAppNotificationCampaign,
  type WhatsAppCampaignApp,
  type WhatsAppCampaignRecipientStatus,
} from '../models/WhatsAppNotificationCampaign';
import { userServiceClient } from './UserServiceClient';
import {
  normalizeWhatsAppRecipientPhone,
  sendDialogTemplateMessage,
} from './WhatsAppDispatchService';

const RECIPIENT_PAGE_SIZE = 500;
const SEND_CONCURRENCY = 10;
const STALE_SEND_MS = 5 * 60 * 1000;
const STALE_PREPARATION_MS = 30 * 60 * 1000;
const activeCampaigns = new Set<string>();

export class WhatsAppCampaignInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppCampaignInputError';
  }
}

type AudienceInput = {
  app: WhatsAppCampaignApp;
  categories: string[];
  cities: string[];
  workAreas: string[];
};

type DialogTemplate = {
  id: string;
  organizationId: string;
  metaTemplateName: string;
  category: string;
  language: string;
  metaStatus: string;
  preview?: Record<string, unknown>;
  currentVersionDetail?: {
    variableSchema?: unknown;
    components?: unknown;
  } | null;
};

type CampaignForSend = {
  _id: unknown;
  app: WhatsAppCampaignApp;
  templateName: string;
  templateLanguage: string;
  variables: Record<string, string>;
};

function assertDialogConfiguration(): void {
  if (!env.DIALOG_SERVICE_URL || !env.DIALOG_ORGANIZATION_ID || !env.DIALOG_API_KEY) {
    throw new Error('Dialog template and messaging configuration is incomplete');
  }
}

function dialogHeaders() {
  return {
    'X-API-Key': env.DIALOG_API_KEY!,
    'Content-Type': 'application/json',
  };
}

function dialogBaseUrl(): string {
  return env.DIALOG_SERVICE_URL!.replace(/\/+$/, '');
}

export async function listApprovedWhatsAppTemplates(): Promise<DialogTemplate[]> {
  assertDialogConfiguration();
  const templates: DialogTemplate[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await axios.get(`${dialogBaseUrl()}/api/v1/templates`, {
      params: { metaStatus: 'APPROVED', page, limit: 100 },
      headers: dialogHeaders(),
      timeout: 12000,
    });
    const pageTemplates = response.data?.data;
    const pages = response.data?.meta?.totalPages;
    if (!Array.isArray(pageTemplates) || !Number.isInteger(pages) || pages < 1) {
      throw new Error('Dialog returned an invalid approved-template response');
    }

    templates.push(...pageTemplates);
    totalPages = pages;
    page += 1;
  } while (page <= totalPages);

  return templates.filter(
    (template) =>
      template.metaStatus === 'APPROVED' &&
      template.organizationId === env.DIALOG_ORGANIZATION_ID,
  );
}

async function getApprovedWhatsAppTemplate(templateId: string): Promise<DialogTemplate> {
  assertDialogConfiguration();
  const response = await axios.get(
    `${dialogBaseUrl()}/api/v1/templates/${encodeURIComponent(templateId)}`,
    { headers: dialogHeaders(), timeout: 12000 },
  );
  const template = response.data?.data as DialogTemplate | undefined;
  if (
    !template ||
    template.id !== templateId ||
    template.metaStatus !== 'APPROVED' ||
    template.organizationId !== env.DIALOG_ORGANIZATION_ID
  ) {
    throw new WhatsAppCampaignInputError(
      'The selected template is no longer approved or is not available for this organization',
    );
  }
  return template;
}

function collectTemplateVariableIndexes(value: unknown, found = new Set<number>()): number[] {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{\{(\d+)\}\}/g)) {
      const index = Number(match[1]);
      if (Number.isSafeInteger(index) && index > 0) found.add(index);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectTemplateVariableIndexes(item, found);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectTemplateVariableIndexes(item, found);
  }
  return [...found].sort((first, second) => first - second);
}

function templateVariableIndexes(template: DialogTemplate): number[] {
  const schema = template.currentVersionDetail?.variableSchema;
  let schemaIndexes: number[] = [];
  if (schema && typeof schema === 'object' && 'variables' in schema) {
    const variables = (schema as { variables?: unknown }).variables;
    if (Array.isArray(variables)) {
      schemaIndexes = variables
        .map((variable) =>
          variable && typeof variable === 'object' && 'index' in variable
            ? Number((variable as { index: unknown }).index)
            : Number.NaN,
        )
        .filter((index) => Number.isSafeInteger(index) && index > 0);
    }
  }
  const componentIndexes = collectTemplateVariableIndexes(
    template.currentVersionDetail?.components,
  );
  return [...new Set([...schemaIndexes, ...componentIndexes])].sort((a, b) => a - b);
}

function normalizeAudience(input: AudienceInput): AudienceInput {
  const cleanList = (values: string[], maxCount: number, label: string) => {
    if (!Array.isArray(values) || values.length > maxCount) {
      throw new WhatsAppCampaignInputError(`Select no more than ${maxCount} ${label}`);
    }
    const result = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    if (result.some((value) => value.length > 120)) {
      throw new WhatsAppCampaignInputError(`One or more ${label} values are too long`);
    }
    return result;
  };
  const categories = cleanList(input.categories || [], 50, 'categories');
  const cities = cleanList(input.cities || [], 100, 'cities');
  const workAreas = cleanList(input.workAreas || [], 5000, 'work areas');

  if (input.app === 'helper_app' && (!categories.length || !cities.length || !workAreas.length)) {
    throw new WhatsAppCampaignInputError(
      'Select at least one category and city with work areas for the Partner App',
    );
  }
  if (input.app !== 'helper_app' && (categories.length || cities.length || workAreas.length)) {
    throw new WhatsAppCampaignInputError('Category and city filters are only available for the Partner App');
  }
  return { ...input, categories, cities, workAreas };
}

async function getAudiencePage(input: AudienceInput, page: number, limit: number) {
  const response = await userServiceClient.listWhatsAppAudience({
    ...input,
    page,
    limit,
  });
  if (
    response?.success !== true ||
    !Array.isArray(response.data) ||
    !response.pagination ||
    !Number.isInteger(response.pagination.total) ||
    !Number.isInteger(response.pagination.pages)
  ) {
    throw new Error('User service returned an invalid WhatsApp audience response');
  }
  return response;
}

export async function countWhatsAppAudience(input: AudienceInput): Promise<number> {
  const audience = normalizeAudience(input);
  const response = await getAudiencePage(audience, 1, 1);
  return response.pagination.total;
}

async function resolveWhatsAppAudienceUids(input: AudienceInput): Promise<string[]> {
  const firstPage = await getAudiencePage(input, 1, RECIPIENT_PAGE_SIZE);
  const uids = [...firstPage.data];
  for (let page = 2; page <= firstPage.pagination.pages; page += 1) {
    const response = await getAudiencePage(input, page, RECIPIENT_PAGE_SIZE);
    if (response.pagination.total !== firstPage.pagination.total) {
      throw new Error('WhatsApp audience changed while it was being prepared; please retry');
    }
    uids.push(...response.data);
  }

  const uniqueUids = [...new Set(uids.map((uid) => String(uid).trim()).filter(Boolean))];
  if (uniqueUids.length !== firstPage.pagination.total) {
    throw new Error('User service returned an inconsistent WhatsApp audience');
  }
  return uniqueUids;
}

export async function createWhatsAppCampaign(input: {
  app: WhatsAppCampaignApp;
  categories: string[];
  cities: string[];
  workAreas: string[];
  templateId: string;
  variables: Record<string, string>;
  createdBy: string;
}): Promise<{ id: string; recipientCount: number; status: 'sending' }> {
  const audience = normalizeAudience({
    app: input.app,
    categories: input.categories,
    cities: input.cities,
    workAreas: input.workAreas,
  });
  if (!input.templateId.trim() || input.templateId.length > 200) {
    throw new WhatsAppCampaignInputError('Select an approved WhatsApp template');
  }

  const [template, recipientUids] = await Promise.all([
    getApprovedWhatsAppTemplate(input.templateId),
    resolveWhatsAppAudienceUids(audience),
  ]);
  if (recipientUids.length === 0) {
    throw new WhatsAppCampaignInputError('There are no eligible recipients for these filters');
  }

  const indexes = templateVariableIndexes(template);
  const suppliedVariables =
    input.variables && typeof input.variables === 'object' ? input.variables : {};
  const expectedKeys = new Set(indexes.map(String));
  const suppliedKeys = Object.keys(suppliedVariables);
  if (
    suppliedKeys.some((key) => !expectedKeys.has(key)) ||
    indexes.some((index) => {
      const value = suppliedVariables[String(index)];
      return typeof value !== 'string' || !value.trim() || value.length > 1024;
    })
  ) {
    throw new WhatsAppCampaignInputError(
      'Enter a value for every template variable and remove any unexpected values',
    );
  }

  const campaign = await WhatsAppNotificationCampaign.create({
    app: input.app,
    templateId: template.id,
    templateName: template.metaTemplateName,
    templateLanguage: template.language,
    templateCategory: template.category,
    variables: Object.fromEntries(
      indexes.map((index) => [String(index), suppliedVariables[String(index)].trim()]),
    ),
    cities: audience.cities,
    categories: audience.categories,
    recipientCount: recipientUids.length,
    status: 'preparing',
    createdBy: input.createdBy || 'admin',
  });

  for (let offset = 0; offset < recipientUids.length; offset += RECIPIENT_PAGE_SIZE) {
    await WhatsAppCampaignRecipient.insertMany(
      recipientUids.slice(offset, offset + RECIPIENT_PAGE_SIZE).map((recipientUid) => ({
        campaignId: campaign._id,
        recipientUid,
        status: 'pending',
        attemptCount: 0,
      })),
      { ordered: true },
    );
  }

  const readyCampaign = await WhatsAppNotificationCampaign.updateOne(
    { _id: campaign._id, status: 'preparing' },
    { $set: { status: 'sending' } },
  );
  if (readyCampaign.modifiedCount !== 1) {
    throw new Error('WhatsApp campaign could not be moved to sending state');
  }

  startCampaignProcessing(String(campaign._id));
  return {
    id: String(campaign._id),
    recipientCount: recipientUids.length,
    status: 'sending',
  };
}

function recipientIdempotencyKey(campaignId: string, recipientUid: string): string {
  const digest = createHash('sha256').update(recipientUid).digest('hex');
  return `admin_whatsapp:${campaignId}:${digest}`;
}

function profileFromResponse(response: unknown): Record<string, unknown> | null {
  if (!response || typeof response !== 'object') return null;
  const body = response as Record<string, unknown>;
  const profile =
    body.profile ??
    (body.data && typeof body.data === 'object'
      ? (body.data as Record<string, unknown>).profile ?? body.data
      : body.data);
  return profile && typeof profile === 'object'
    ? (profile as Record<string, unknown>)
    : null;
}

async function sendCampaignRecipient(
  campaign: CampaignForSend,
  recipient: { _id: unknown; recipientUid: string },
): Promise<void> {
  const userServiceUrl = (env.USER_SERVICE_URL || 'http://localhost:4001').replace(/\/+$/, '');
  const serviceHeaders = {
    'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
    'X-Service-Name': 'main-admin-server',
  };
  const recordId = recipient._id;

  try {
    if (campaign.app === 'helper_app') {
      const preferenceResponse = await axios.get(
        `${userServiceUrl}/api/v1/notification-preferences/${encodeURIComponent(recipient.recipientUid)}/can-send`,
        {
          params: { channel: 'whatsapp', category: 'recommendedTaskAlerts' },
          headers: serviceHeaders,
          timeout: 5000,
        },
      );
      if (preferenceResponse.data?.data?.canSend !== true) {
        await WhatsAppCampaignRecipient.updateOne(
          { _id: recordId, status: 'sending' },
          { $set: { status: 'suppressed', lastError: 'Partner WhatsApp preference is disabled' } },
        );
        return;
      }
    }

    const profileResponse = await axios.get(
      `${userServiceUrl}/api/v1/profiles/internal/${encodeURIComponent(recipient.recipientUid)}`,
      { headers: serviceHeaders, timeout: 5000 },
    );
    const profile = profileFromResponse(profileResponse.data);
    const phone = profile ? normalizeWhatsAppRecipientPhone(profile) : null;
    if (!phone) {
      await WhatsAppCampaignRecipient.updateOne(
        { _id: recordId, status: 'sending' },
        { $set: { status: 'suppressed', lastError: 'Profile has no valid phone number' } },
      );
      return;
    }

    const providerEventId = await sendDialogTemplateMessage({
      template: campaign.templateName,
      language: campaign.templateLanguage,
      to: phone,
      variables: campaign.variables,
      idempotencyKey: recipientIdempotencyKey(
        String(campaign._id),
        recipient.recipientUid,
      ),
    });
    await WhatsAppCampaignRecipient.updateOne(
      { _id: recordId, status: 'sending' },
      {
        $set: { status: 'queued', providerEventId },
        $unset: { lastError: 1 },
      },
    );
  } catch (error) {
    const axiosError = error as AxiosError;
    const statusCode = axiosError.response?.status;
    const lastError = `Messaging request failed${statusCode ? ` (${statusCode})` : ''}`;
    await WhatsAppCampaignRecipient.updateOne(
      { _id: recordId, status: 'sending' },
      { $set: { status: 'failed', lastError } },
    );
    logger.warn('Admin WhatsApp campaign message failed', {
      campaignId: String(campaign._id),
      recipientUid: recipient.recipientUid,
      status: statusCode,
      message: axiosError.message,
    });
  }
}

async function finishCampaignIfComplete(campaignId: string): Promise<void> {
  const unfinishedCount = await WhatsAppCampaignRecipient.countDocuments({
    campaignId,
    status: { $in: ['pending', 'sending'] },
  });
  if (unfinishedCount > 0) return;

  const counts = await WhatsAppCampaignRecipient.aggregate([
    { $match: { campaignId: new mongoose.Types.ObjectId(campaignId) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const statusCounts = new Map<string, number>(
    counts.map((item: { _id: string; count: number }) => [item._id, item.count]),
  );
  const failedCount = statusCounts.get('failed') || 0;
  const suppressedCount = statusCounts.get('suppressed') || 0;
  const queuedCount = statusCounts.get('queued') || 0;
  const finalStatus =
    queuedCount === 0 && failedCount > 0
      ? 'failed'
      : failedCount > 0 || suppressedCount > 0
        ? 'sent_with_errors'
        : 'sent';

  await WhatsAppNotificationCampaign.updateOne(
    { _id: campaignId, status: 'sending' },
    { $set: { status: finalStatus, completedAt: new Date() } },
  );
}

async function processWhatsAppCampaign(campaignId: string): Promise<void> {
  while (true) {
    const campaign = await WhatsAppNotificationCampaign.findOne({ _id: campaignId }).lean();
    if (!campaign || campaign.status !== 'sending') return;

    const candidates = await WhatsAppCampaignRecipient.find({
      campaignId,
      status: 'pending',
    })
      .sort({ createdAt: 1 })
      .limit(SEND_CONCURRENCY)
      .select('_id recipientUid')
      .lean();

    if (candidates.length === 0) {
      await finishCampaignIfComplete(campaignId);
      return;
    }

    const claimed = await Promise.all(
      candidates.map((candidate) =>
        WhatsAppCampaignRecipient.findOneAndUpdate(
          { _id: candidate._id, status: 'pending' },
          { $set: { status: 'sending' }, $inc: { attemptCount: 1 } },
          { new: true },
        )
          .select('_id recipientUid')
          .lean(),
      ),
    );
    await Promise.all(
      claimed
        .filter((recipient): recipient is NonNullable<typeof recipient> => recipient !== null)
        .map((recipient) => sendCampaignRecipient(campaign, recipient)),
    );
  }
}

function startCampaignProcessing(campaignId: string): void {
  if (activeCampaigns.has(campaignId)) return;
  activeCampaigns.add(campaignId);
  setImmediate(() => {
    void processWhatsAppCampaign(campaignId)
      .catch(async (error) => {
        logger.error('Admin WhatsApp campaign processing stopped unexpectedly', {
          campaignId,
          error,
        });
        try {
          await WhatsAppNotificationCampaign.updateOne(
            { _id: campaignId, status: 'sending' },
            { $set: { status: 'failed', completedAt: new Date() } },
          );
        } catch (recoveryError) {
          logger.error('Failed to mark interrupted WhatsApp campaign as failed', {
            campaignId,
            error: recoveryError,
          });
        }
      })
      .finally(() => activeCampaigns.delete(campaignId));
  });
}

export async function resumePendingWhatsAppCampaigns(
  recoverInterruptedPreparation = false,
): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_SEND_MS);
  if (recoverInterruptedPreparation) {
    await WhatsAppNotificationCampaign.updateMany(
      {
        status: 'preparing',
        createdAt: { $lt: new Date(Date.now() - STALE_PREPARATION_MS) },
      },
      { $set: { status: 'failed', completedAt: new Date() } },
    );
  }
  await WhatsAppCampaignRecipient.updateMany(
    { status: 'sending', updatedAt: { $lt: staleBefore } },
    { $set: { status: 'pending' } },
  );
  const campaigns = await WhatsAppNotificationCampaign.find({ status: 'sending' })
    .select('_id')
    .lean();
  for (const campaign of campaigns) startCampaignProcessing(String(campaign._id));
}

export async function listWhatsAppCampaignHistory(input: {
  page: number;
  limit: number;
}): Promise<{
  data: Array<Record<string, unknown>>;
  pagination: { page: number; limit: number; total: number; pages: number };
}> {
  const [campaigns, total] = await Promise.all([
    WhatsAppNotificationCampaign.find()
      .sort({ createdAt: -1 })
      .skip((input.page - 1) * input.limit)
      .limit(input.limit)
      .lean(),
    WhatsAppNotificationCampaign.countDocuments(),
  ]);
  const campaignIds = campaigns.map((campaign) => campaign._id);
  const groupedCounts = campaignIds.length
    ? await WhatsAppCampaignRecipient.aggregate([
        { $match: { campaignId: { $in: campaignIds } } },
        { $group: { _id: { campaignId: '$campaignId', status: '$status' }, count: { $sum: 1 } } },
      ])
    : [];
  const countsByCampaign = new Map<string, Record<string, number>>();
  for (const item of groupedCounts as Array<{
    _id: { campaignId: { toString(): string }; status: WhatsAppCampaignRecipientStatus };
    count: number;
  }>) {
    const id = item._id.campaignId.toString();
    const counts = countsByCampaign.get(id) || {};
    counts[item._id.status] = item.count;
    countsByCampaign.set(id, counts);
  }

  return {
    data: campaigns.map((campaign) => ({
      id: String(campaign._id),
      app: campaign.app,
      templateId: campaign.templateId,
      templateName: campaign.templateName,
      templateLanguage: campaign.templateLanguage,
      templateCategory: campaign.templateCategory,
      cities: campaign.cities,
      categories: campaign.categories,
      recipientCount: campaign.recipientCount,
      status: campaign.status,
      createdBy: campaign.createdBy,
      createdAt: campaign.createdAt,
      completedAt: campaign.completedAt,
      recipientStatuses: countsByCampaign.get(String(campaign._id)) || {},
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      pages: Math.ceil(total / input.limit),
    },
  };
}

export async function listWhatsAppCampaignRecipients(input: {
  campaignId: string;
  page: number;
  limit: number;
}): Promise<{
  data: Array<Record<string, unknown>>;
  pagination: { page: number; limit: number; total: number; pages: number };
}> {
  const campaign = await WhatsAppNotificationCampaign.findOne({ _id: input.campaignId })
    .select('_id')
    .lean();
  if (!campaign) throw new WhatsAppCampaignInputError('WhatsApp campaign was not found');

  const [recipients, total] = await Promise.all([
    WhatsAppCampaignRecipient.find({ campaignId: campaign._id })
      .sort({ createdAt: 1 })
      .skip((input.page - 1) * input.limit)
      .limit(input.limit)
      .select('recipientUid status attemptCount providerEventId lastError updatedAt')
      .lean(),
    WhatsAppCampaignRecipient.countDocuments({ campaignId: campaign._id }),
  ]);
  return {
    data: recipients.map((recipient) => ({
      uid: recipient.recipientUid,
      status: recipient.status,
      attemptCount: recipient.attemptCount,
      providerEventId: recipient.providerEventId || null,
      lastError: recipient.lastError || null,
      updatedAt: recipient.updatedAt,
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      pages: Math.ceil(total / input.limit),
    },
  };
}
