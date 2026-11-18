import assert from 'node:assert/strict';
import { selectRetryRecipients, sendToRecipientsIndividually } from '../services/TaskPostedEmailRecipients';

async function main(): Promise<void> {
  assert.deepEqual(
    selectRetryRecipients(
      { status: 'partial', recipients: ['first@example.com', 'bad@example.com'], failedRecipients: ['bad@example.com'] },
      ['first@example.com', 'bad@example.com'],
    ),
    ['bad@example.com'],
  );
  assert.deepEqual(
    selectRetryRecipients(
      { status: 'sent', recipients: ['first@example.com'], failedRecipients: [] },
      ['first@example.com'],
    ),
    [],
  );

  const attempts: string[] = [];
  let activeSends = 0;
  let maxActiveSends = 0;
  let badRecipientAttempts = 0;
  const result = await sendToRecipientsIndividually(
    ['first@example.com', 'bad@example.com', 'last@example.com'],
    async (recipient) => {
      attempts.push(recipient);
      activeSends += 1;
      maxActiveSends = Math.max(maxActiveSends, activeSends);
      await Promise.resolve();
      activeSends -= 1;
      if (recipient === 'bad@example.com') {
        badRecipientAttempts += 1;
        if (badRecipientAttempts < 4) {
          throw new Error('Rejected');
        }
      }
    },
    async () => {},
  );

  assert.deepEqual(attempts, [
    'first@example.com',
    'bad@example.com',
    'bad@example.com',
    'bad@example.com',
    'bad@example.com',
    'last@example.com',
  ]);
  assert.equal(badRecipientAttempts, 4);
  assert.equal(maxActiveSends, 1);
  assert.deepEqual(result.sentRecipients, ['first@example.com', 'bad@example.com', 'last@example.com']);
  assert.deepEqual(result.failures, []);

  const exhaustedAttempts: string[] = [];
  const exhaustedResult = await sendToRecipientsIndividually(
    ['always-fails@example.com', 'still-try@example.com'],
    async (recipient) => {
      exhaustedAttempts.push(recipient);
      if (recipient === 'always-fails@example.com') {
        throw new Error('Temporarily rejected');
      }
    },
    async () => {},
  );
  assert.deepEqual(exhaustedAttempts, [
    'always-fails@example.com',
    'always-fails@example.com',
    'always-fails@example.com',
    'always-fails@example.com',
    'still-try@example.com',
  ]);
  assert.deepEqual(exhaustedResult.sentRecipients, ['still-try@example.com']);
  assert.deepEqual(exhaustedResult.failures, [
    { recipient: 'always-fails@example.com', error: 'Temporarily rejected' },
  ]);
}

void main().then(() => {
  console.log('TaskPostedEmailRecipients.test.ts passed');
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
