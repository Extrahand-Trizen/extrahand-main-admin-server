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
assert.strictEqual(matchesNotificationBroadcastAccessToken('secret-token', 'secret-token'), true);
assert.strictEqual(matchesNotificationBroadcastAccessToken('wrong-token', 'secret-token'), false);
assert.strictEqual(matchesNotificationBroadcastAccessToken('short', 'secret-token'), false);
assert.strictEqual(matchesNotificationBroadcastAccessToken(undefined, 'secret-token'), false);
assert.strictEqual(matchesNotificationBroadcastAccessToken('secret-token', undefined), false);

console.log('notificationBroadcastAccessToken.test.ts: all tests passed');
