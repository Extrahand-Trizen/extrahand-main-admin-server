import assert from 'assert';
import {
  getNotificationBroadcastAccessToken,
  matchesNotificationBroadcastAccessToken,
} from '../utils/notificationBroadcastAccessToken';

assert.strictEqual(getNotificationBroadcastAccessToken('Bearer secret-token'), 'secret-token');
assert.strictEqual(getNotificationBroadcastAccessToken('bearer secret-token'), 'secret-token');
assert.strictEqual(getNotificationBroadcastAccessToken('Basic secret-token'), undefined);
assert.strictEqual(getNotificationBroadcastAccessToken('Bearer secret-token extra'), undefined);
assert.strictEqual(getNotificationBroadcastAccessToken(undefined), undefined);
const createdAt = '2026-11-26';
const expiresAt = Date.parse(createdAt) + 60 * 24 * 60 * 60 * 1000;
assert.strictEqual(matchesNotificationBroadcastAccessToken(
  'secret-token',
  'secret-token',
  '60',
  createdAt,
  expiresAt - 1,
), true);
assert.strictEqual(matchesNotificationBroadcastAccessToken(
  'secret-token',
  'secret-token',
  '60d',
  createdAt,
  expiresAt,
), false);
assert.strictEqual(matchesNotificationBroadcastAccessToken('secret-token', 'secret-token', 'never', undefined), true);
assert.strictEqual(matchesNotificationBroadcastAccessToken('wrong-token', 'secret-token', '60', createdAt, expiresAt - 1), false);
assert.strictEqual(matchesNotificationBroadcastAccessToken('short', 'secret-token', '60', createdAt, expiresAt - 1), false);
assert.strictEqual(matchesNotificationBroadcastAccessToken(undefined, 'secret-token', '60', createdAt, expiresAt - 1), false);
assert.strictEqual(matchesNotificationBroadcastAccessToken('secret-token', undefined, '60', createdAt, expiresAt - 1), false);
assert.strictEqual(matchesNotificationBroadcastAccessToken('secret-token', 'secret-token', '60', undefined, expiresAt - 1), false);
assert.strictEqual(matchesNotificationBroadcastAccessToken('secret-token', 'secret-token', 'invalid', createdAt, expiresAt - 1), false);
assert.strictEqual(matchesNotificationBroadcastAccessToken('secret-token', 'secret-token', '60', '2026-02-31', expiresAt - 1), false);

console.log('notificationBroadcastAccessToken.test.ts: all tests passed');
