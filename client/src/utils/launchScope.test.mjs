import assert from 'node:assert/strict';
import test from 'node:test';
import { getLaunchRedirect, LAUNCH_BUSINESS_HUB_TABS } from './launchScope.js';

test('business workspace URLs are not redirected to the public profile', () => {
  assert.equal(getLaunchRedirect('/business/1/workspace'), null);
  assert.equal(getLaunchRedirect('/business/1/workspace/profile'), null);
  assert.equal(getLaunchRedirect('/business/1/maintenance-request'), '/business/1');
});

test('hiring is available in Business Hub for owners and managers', () => {
  assert.equal(LAUNCH_BUSINESS_HUB_TABS.has('hiring'), true);
  assert.equal(LAUNCH_BUSINESS_HUB_TABS.has('team'), true);
});
