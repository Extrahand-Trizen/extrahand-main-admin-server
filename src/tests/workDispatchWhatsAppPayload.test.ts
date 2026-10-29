import assert from 'node:assert/strict';
import { buildWorkDispatchWhatsAppPayload } from '../utils/workDispatchWhatsAppPayload';

const taskId = '665f1c2e9b1e8a0012345678';
const common = {
  taskId,
  title: 'Fix kitchen sink leak',
  category: 'Plumbing',
  locationLabel: 'Sector 45, Gurgaon',
};

for (const stage of ['preferred', 'area_rule', 'all'] as const) {
  const payload = buildWorkDispatchWhatsAppPayload(
    { ...common, stage },
    '919876543210',
    'partner-uid',
  );
  assert.equal(payload.eventKey, 'TASK_NEARBY');
  assert.equal(payload.recipientPhone, '919876543210');
  assert.deepEqual(payload.payload, {
    taskTitle: common.title,
    categoryLabel: common.category,
    locationLabel: common.locationLabel,
    taskId,
    workId: taskId,
    buttonUrlSuffix: taskId,
    dispatchStage: stage,
  });
  assert.equal(
    payload.idempotencyKey,
    `book_now_offer:${taskId}:partner-uid:${stage}`,
  );
}

assert.notEqual(
  buildWorkDispatchWhatsAppPayload({ ...common, stage: 'preferred' }, '919876543210', 'partner-uid')
    .idempotencyKey,
  buildWorkDispatchWhatsAppPayload({ ...common, stage: 'area_rule' }, '919876543210', 'partner-uid')
    .idempotencyKey,
  'Dispatch stages must use separate idempotency keys',
);

console.log('workDispatchWhatsAppPayload.test.ts: all tests passed');
