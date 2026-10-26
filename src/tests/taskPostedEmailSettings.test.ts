import assert from 'node:assert/strict';
import { isPhoneExcluded } from '../services/TaskPostedEmailSettingsService';

assert.equal(isPhoneExcluded('9999999999', []), true);
assert.equal(isPhoneExcluded('6666666666', []), true);
assert.equal(isPhoneExcluded('7777777777', []), true);
assert.equal(isPhoneExcluded('+91 8888888888', []), true);
assert.equal(isPhoneExcluded('9132299547', []), false);
assert.equal(isPhoneExcluded('9132299547', ['9132299547']), true);

console.log('taskPostedEmailSettings.test.ts passed');
