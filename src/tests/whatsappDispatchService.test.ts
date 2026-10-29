import assert from 'node:assert/strict';
import axios from 'axios';

process.env.MONGODB_URI = 'mongodb://localhost/whatsapp-dispatch-tests';
process.env.JWT_SECRET = 'whatsapp-dispatch-test-jwt-secret-minimum-32';
process.env.JWT_REFRESH_SECRET = 'whatsapp-dispatch-test-refresh-secret-minimum-32';
process.env.SERVICE_AUTH_TOKEN = 'whatsapp-dispatch-test-service-auth-token';
process.env.DIALOG_SERVICE_URL = 'http://dialog.test';
process.env.DIALOG_ORGANIZATION_ID = 'dialog-test-organization';
process.env.DIALOG_API_KEY = 'tdk_live_test-dialog-messages-key';

const {
  dispatchWorkWhatsApp,
  retryFailedWorkWhatsAppDispatches,
  updateWhatsAppNotificationSettings,
} = require('../services/WhatsAppDispatchService') as typeof import('../services/WhatsAppDispatchService');
const { WhatsAppDispatchRecord } = require('../models/WhatsAppDispatchRecord') as typeof import('../models/WhatsAppDispatchRecord');
const { WhatsAppNotificationSettings } = require('../models/WhatsAppNotificationSettings') as typeof import('../models/WhatsAppNotificationSettings');

type MockRecord = Record<string, unknown>;
const records = new Map<string, MockRecord>();
let enabled = false;
let sendCount = 0;
let failNextSend = false;
let canSendPreference = true;
let lastPayload: Record<string, unknown> | null = null;

const savedDescriptors = new Map<object, Map<string, PropertyDescriptor | undefined>>();

function replaceMethod(target: object, name: string, value: unknown): void {
  if (!savedDescriptors.has(target)) savedDescriptors.set(target, new Map());
  savedDescriptors.get(target)!.set(name, Object.getOwnPropertyDescriptor(target, name));
  Object.defineProperty(target, name, { configurable: true, value });
}

function restoreMethods(): void {
  for (const [target, methods] of savedDescriptors) {
    for (const [name, descriptor] of methods) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else Reflect.deleteProperty(target, name);
    }
  }
  savedDescriptors.clear();
}

function applyUpdate(record: MockRecord, update: MockRecord): MockRecord {
  Object.assign(record, update.$set || {});
  for (const field of Object.keys((update.$unset || {}) as object)) {
    delete record[field];
  }
  for (const [field, amount] of Object.entries((update.$inc || {}) as Record<string, number>)) {
    record[field] = Number(record[field] || 0) + amount;
  }
  return record;
}

function matchesRecord(record: MockRecord, filter: MockRecord): boolean {
  if (filter._id && record._id !== filter._id) return false;
  if (filter.idempotencyKey && record.idempotencyKey !== filter.idempotencyKey) return false;
  if (filter.status && record.status !== filter.status) return false;
  if (filter.attemptCount && Number(record.attemptCount) >= Number((filter.attemptCount as Record<string, number>).$lt)) return false;
  return true;
}

function installMocks(): void {
  replaceMethod(WhatsAppNotificationSettings, 'findOne', () => ({
    lean: async () => ({ enabled }),
  }));
  replaceMethod(WhatsAppNotificationSettings, 'findOneAndUpdate', (_filter: unknown, update: MockRecord) => {
    enabled = Boolean((update.$set as MockRecord).enabled);
    return { lean: async () => ({ enabled }) };
  });
  replaceMethod(WhatsAppDispatchRecord, 'create', async (input: MockRecord) => {
    const key = String(input.idempotencyKey);
    if (records.has(key)) {
      throw Object.assign(new Error('duplicate key'), { code: 11000 });
    }
    const record = { ...input, _id: key, createdAt: new Date(), updatedAt: new Date() };
    records.set(key, record);
    return record;
  });
  replaceMethod(WhatsAppDispatchRecord, 'findOneAndUpdate', (filter: MockRecord, update: MockRecord) => {
    const record = Array.from(records.values()).find((item) => matchesRecord(item, filter));
    if (!record) return { select: () => ({ lean: async () => null }) };
    if (filter.$or) {
      const eligible = record.status === 'failed' ||
        (record.status === 'sending' && new Date(String(record.updatedAt)).getTime() < Date.now() - 300000);
      if (!eligible) return { select: () => ({ lean: async () => null }) };
    }
    applyUpdate(record, update);
    record.updatedAt = new Date();
    return { select: () => ({ lean: async () => record }) };
  });
  replaceMethod(WhatsAppDispatchRecord, 'updateOne', async (filter: MockRecord, update: MockRecord) => {
    const record = Array.from(records.values()).find((item) => matchesRecord(item, filter));
    if (record) applyUpdate(record, update);
    return { modifiedCount: record ? 1 : 0 };
  });
  replaceMethod(WhatsAppDispatchRecord, 'updateMany', async (filter: MockRecord, update: MockRecord) => {
    let modifiedCount = 0;
    for (const record of records.values()) {
      if (matchesRecord(record, filter)) {
        applyUpdate(record, update);
        modifiedCount += 1;
      }
    }
    return { modifiedCount };
  });
  replaceMethod(WhatsAppDispatchRecord, 'find', (filter: MockRecord) => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () =>
      Array.from(records.values())
        .filter((record) => matchesRecord(record, filter))
        .map((record) => ({ ...record })),
  }));
  replaceMethod(axios, 'get', async (url: string) => {
    if (url.includes('/notification-preferences/')) {
      return { data: { data: { canSend: canSendPreference } } };
    }
    return { data: { profile: { phone: '9876543210' } } };
  });
  replaceMethod(axios, 'post', async (_url: string, payload: Record<string, unknown>) => {
    sendCount += 1;
    lastPayload = payload;
    if (failNextSend) {
      failNextSend = false;
      throw Object.assign(new Error('provider unavailable'), { response: { status: 503 } });
    }
    return { status: 202, data: { data: { eventIngestId: `event-${sendCount}` } } };
  });
}

async function runTests(): Promise<void> {
  installMocks();
  try {
    const taskId = '665f1c2e9b1e8a0012345678';
    const baseInput = {
      taskId,
      stage: 'preferred' as const,
      recipientUids: ['partner-uid'],
      title: 'Fix kitchen sink leak',
      category: 'Plumbing',
      locationLabel: 'Sector 45, Gurgaon',
    };

    await updateWhatsAppNotificationSettings(false, 'admin-user');
    const disabled = await dispatchWorkWhatsApp(baseInput);
    assert.equal(disabled.disabledCount, 1);
    assert.equal(sendCount, 0);

    await updateWhatsAppNotificationSettings(true, 'admin-user');
    const noBacklog = await dispatchWorkWhatsApp(baseInput);
    assert.equal(noBacklog.duplicateCount, 1);
    assert.equal(sendCount, 0, 'Turning notifications back on must not replay disabled events');

    const areaRule = await dispatchWorkWhatsApp({ ...baseInput, stage: 'area_rule' });
    assert.equal(areaRule.queuedCount, 1);
    assert.equal(sendCount, 1);
    assert.equal(lastPayload?.template, 'extrahand_nearby_work_skill_match');
    assert.equal(lastPayload?.to, '919876543210');
    assert.deepEqual(lastPayload?.variables, {
      '1': baseInput.title,
      '2': baseInput.category,
      '3': baseInput.locationLabel,
      buttonUrlSuffix: taskId,
      taskId,
      workId: taskId,
      dispatchStage: 'area_rule',
    });
    assert.equal(
      (Array.from(records.values()).find((record) => record.dispatchStage === 'area_rule'))?.status,
      'queued',
      'API acceptance is recorded as queued, not delivered',
    );
    assert.equal((await dispatchWorkWhatsApp({ ...baseInput, stage: 'area_rule' })).duplicateCount, 1);
    assert.equal(sendCount, 1, 'Duplicate stage events must not enqueue a second message');

    canSendPreference = false;
    const preferenceDisabled = await dispatchWorkWhatsApp({
      ...baseInput,
      stage: 'all',
      recipientUids: ['preference-disabled-partner'],
    });
    assert.equal(preferenceDisabled.suppressedCount, 1);
    assert.equal(sendCount, 1, 'Disabled WhatsApp preferences must suppress Dialog sends');
    canSendPreference = true;

    failNextSend = true;
    const failed = await dispatchWorkWhatsApp({ ...baseInput, stage: 'all' });
    assert.equal(failed.failedCount, 1);
    assert.equal(
      (Array.from(records.values()).find((record) =>
        record.dispatchStage === 'all' && record.partnerUid === 'partner-uid'))?.status,
      'failed',
    );

    await retryFailedWorkWhatsAppDispatches();
    assert.equal(sendCount, 3, 'A failed send is retried by the worker');
    assert.equal(
      (Array.from(records.values()).find((record) =>
        record.dispatchStage === 'all' && record.partnerUid === 'partner-uid'))?.status,
      'queued',
    );
    assert.equal(
      (Array.from(records.values()).find((record) =>
        record.dispatchStage === 'all' && record.partnerUid === 'partner-uid'))?.attemptCount,
      2,
    );

    console.log('whatsappDispatchService.test.ts: all tests passed');
  } finally {
    restoreMethods();
  }
}

void runTests().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
