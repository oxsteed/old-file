import assert from 'node:assert/strict';
import test from 'node:test';
import {
  profileFormFromBusiness,
  mergeBusinessList,
  isBusinessPubliclyListed,
  tagOwnedBusiness,
} from './businessProfileForm.js';

test('profile form fallback and unpublished businesses stay off the public profile', () => {
  const created = tagOwnedBusiness({
    id: 8,
    business_name: 'FastFix',
    description: 'Repairs',
    address_city: 'Columbus',
    setup_status: 'in_progress',
    is_listed: false,
  });
  assert.equal(created._role, 'owner');
  assert.equal(isBusinessPubliclyListed(created), false);
  assert.equal(isBusinessPubliclyListed({ setup_status: 'active', is_listed: true }), true);
  assert.equal(profileFormFromBusiness(created).business_name, 'FastFix');
  assert.equal(profileFormFromBusiness(created).address_city, 'Columbus');
  const merged = mergeBusinessList([created], [{ id: 8, business_name: 'FastFix LLC', _role: 'owner' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].business_name, 'FastFix LLC');
  const kept = mergeBusinessList([created], []);
  assert.equal(kept[0].id, 8);
});
