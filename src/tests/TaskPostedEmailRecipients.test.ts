import assert from 'node:assert/strict';
import { sendToRecipientsIndividually } from '../services/TaskPostedEmailRecipients';

async function main(): Promise<void> {
  const attempts: string[] = [];
  const result = await sendToRecipientsIndividually(
    ['first@example.com', 'bad@example.com', 'last@example.com'],
    async (recipient) => {
      attempts.push(recipient);
      if (recipient === 'bad@example.com') {
        throw new Error('Rejected');
      }
    },
  );

  assert.deepEqual(attempts, ['first@example.com', 'bad@example.com', 'last@example.com']);
  assert.deepEqual(result.sentRecipients, ['first@example.com', 'last@example.com']);
  assert.deepEqual(result.failures, [{ recipient: 'bad@example.com', error: 'Rejected' }]);
}

void main().then(() => {
  console.log('TaskPostedEmailRecipients.test.ts passed');
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
