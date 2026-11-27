import assert from 'node:assert/strict';
import { shouldShowKycReviewRow } from '../utils/kycReviewVisibility';

assert.equal(shouldShowKycReviewRow({ aadhaar: 'failed' }, 'all'), true);
assert.equal(shouldShowKycReviewRow({ aadhaar: 'pending' }, 'all'), false);
assert.equal(shouldShowKycReviewRow({ aadhaar: 'expired' }, 'all'), false);
assert.equal(
  shouldShowKycReviewRow({ aadhaar: 'pending', claimedBy: { userId: 'admin-1' } }, 'all'),
  true,
);
assert.equal(
  shouldShowKycReviewRow({ aadhaar: 'expired', claimedBy: { userId: 'admin-1' } }, 'all'),
  true,
);
assert.equal(shouldShowKycReviewRow({ aadhaar: 'pending' }, 'pending'), false);

console.log('kycReviewVisibility.test.ts passed');
