import assert from 'node:assert/strict';
import test from 'node:test';
import {
  profileFormFromBusiness,
  mergeBusinessList,
  isBusinessPubliclyListed,
  tagOwnedBusiness,
  businessFromEditorResponse,
  businessWorkspacePath,
  emptyBusinessAnalytics,
  BUSINESS_HUB_LAST_ID_LS_KEY,
  resolveBusinessHubSeedId,
  businessHubLandingPath,
  readLastBusinessHubId,
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

test('workspace overview path and editor payload keep a draft reachable', () => {
  assert.equal(businessWorkspacePath(1), '/business/1/workspace');
  assert.equal(businessWorkspacePath(1, 'overview'), '/business/1/workspace');
  assert.equal(businessWorkspacePath(1, 'profile'), '/business/1/workspace/profile');
  assert.deepEqual(businessFromEditorResponse({ business: { id: 1, business_name: 'Draft Co' } }), {
    id: 1,
    business_name: 'Draft Co',
    _role: 'owner',
  });
  const analytics = emptyBusinessAnalytics(1);
  assert.equal(analytics.business_id, 1);
  assert.equal(analytics.invoices.outstanding_total, 0);
  assert.equal(analytics.jobs.completed_6m, 0);
  assert.deepEqual(analytics.mtd, { revenue: 0, expenses: 0, profit: 0 });
});

test('hub seed id and landing path prefer lastBusinessId over bare /business-hub', () => {
  assert.equal(resolveBusinessHubSeedId({ routeBusinessId: '7', lastBusinessId: '1' }), '7');
  assert.equal(resolveBusinessHubSeedId({ routeBusinessId: null, lastBusinessId: '1' }), '1');
  assert.equal(resolveBusinessHubSeedId({}), null);
  assert.equal(businessHubLandingPath(null), '/business-hub');
  assert.equal(businessHubLandingPath('1'), '/business/1/workspace');
  assert.equal(businessHubLandingPath('1', 'profile'), '/business/1/workspace/profile');
  const store = {
    data: { [BUSINESS_HUB_LAST_ID_LS_KEY]: '42' },
    getItem(k) { return this.data[k] ?? null; },
  };
  assert.equal(readLastBusinessHubId(store), '42');
  assert.equal(BUSINESS_HUB_LAST_ID_LS_KEY, 'oxs:bh:lastBusinessId');
});
