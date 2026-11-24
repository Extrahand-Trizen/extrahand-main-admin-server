import assert from 'node:assert/strict';
import {
  filterPreferredPartnerAreaRules,
  getCityAssignmentAreaNames,
} from '../utils/preferredPartnerFilters';

const cityAreas = getCityAssignmentAreaNames({
  name: 'Hyderabad',
  zones: [
    { name: 'LB Nagar Zone', areas: [{ name: 'Nagole' }, { name: 'Uppal' }] },
    { name: 'Secunderabad Zone', areas: [{ name: 'Malkajgiri' }] },
  ],
});

assert.deepEqual(cityAreas, ['Hyderabad', 'Nagole', 'Uppal', 'Malkajgiri']);

const rules = [
  {
    area: 'Nagole',
    category: 'cleaning',
    workTypes: ['book_now'],
    preferredPartners: [{ profileId: 'cleaner-1' }],
  },
  {
    area: 'Uppal',
    category: 'painting',
    workTypes: ['book_now'],
    preferredPartners: [{ profileId: 'painter-1' }],
  },
  {
    area: 'Hyderabad',
    workTypes: ['hourly'],
    preferredPartners: [{ profileId: 'hourly-1' }],
  },
  {
    area: 'Siddipet',
    category: 'cleaning',
    workTypes: ['book_now'],
    preferredPartners: [{ profileId: 'outside-city-1' }],
  },
];

assert.deepEqual(
  filterPreferredPartnerAreaRules(rules, cityAreas, 'book_now', 'CLEANING').map((rule) => rule.area),
  ['Nagole'],
);
assert.deepEqual(
  filterPreferredPartnerAreaRules(rules, cityAreas, 'book_now', 'all').map((rule) => rule.area),
  ['Nagole', 'Uppal'],
);
assert.deepEqual(
  filterPreferredPartnerAreaRules(rules, cityAreas, 'hourly').map((rule) => rule.area),
  ['Hyderabad'],
);

console.log('preferredPartnerFilters.test.ts passed');
