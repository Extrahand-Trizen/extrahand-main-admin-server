import assert from 'node:assert/strict';
import {
  filterTeamWorkByExistingClassification,
  isTeamPostedByExistingFilter,
  partnerMatchesWork,
  projectCustomer,
  projectPartner,
  projectStatusHistory,
} from '../services/TeamWorkReadService';

const excludedPhones = ['15551234567'];
assert.equal(isTeamPostedByExistingFilter('+1 (555) 123-4567', excludedPhones), true);
assert.equal(isTeamPostedByExistingFilter('15550000000', excludedPhones), false);

const teamWork = { _id: 'work-team', requesterId: 'profile-team', status: 'open' };
const customerWork = { _id: 'work-customer', requesterId: 'profile-customer', status: 'open' };
const teamProfile = { _id: 'profile-team', phone: '+1 (555) 123-4567' };
const customerProfile = { _id: 'profile-customer', phone: '15550000000' };

assert.deepEqual(
  filterTeamWorkByExistingClassification(
    [teamWork, customerWork],
    [teamProfile, customerProfile],
    excludedPhones,
  ).map(({ task }) => task._id),
  ['work-team'],
);
assert.deepEqual(
  filterTeamWorkByExistingClassification([teamWork], [], excludedPhones),
  [],
);

const partner = {
  _id: 'partner-1',
  name: 'Synthetic Partner',
  phone: '15550001111',
  roles: ['partner'],
  status: 'active',
  isActive: true,
  email: 'excluded@example.test',
  bankAccount: { accountNumber: 'excluded' },
  partnerProfile: {
    status: 'approved',
    categories: ['cleaning'],
    workAreas: ['Central'],
    vehicle: { number: 'excluded' },
  },
};
assert.equal(partnerMatchesWork(partner, {
  category: 'cleaning',
  location: { taskArea: 'Central' },
}), true);
assert.equal(partnerMatchesWork(partner, {
  category: 'plumbing',
  location: { taskArea: 'Central' },
}), false);

const projectedPartner = projectPartner(partner);
assert.equal('email' in projectedPartner, false);
assert.equal('bankAccount' in projectedPartner, false);
assert.equal('vehicle' in (projectedPartner.partner as Record<string, unknown>), false);
assert.equal(projectCustomer({ _id: 'customer', name: 'Synthetic', phone: '15550002222', email: 'excluded@example.test' }).email, undefined);

const history = projectStatusHistory({
  status: 'assigned',
  rescheduleHistory: [{ actorRole: 'customer', reason: 'Synthetic reason', rescheduledAt: '2026-01-01' }],
});
assert.equal(history.currentStatus, 'assigned');
assert.equal(history.statusHistoryComplete, false);
assert.equal((history.rescheduleHistory as unknown[]).length, 1);
assert.equal(history.statusTransitions, null);

console.log('teamWorkReadService.test.ts passed');
